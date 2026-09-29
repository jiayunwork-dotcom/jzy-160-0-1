# Prony 粘弹核算服务

密封件 / 减振橡胶 CAE 组的粘弹性应力计算后端。输入具名材料档（Prony 级数参数 +
可选 WLF 时温等效参数）与一批应变历程（分段线性控制点 + 可拼接正弦段），
在给定输出时间网格上给出应力 σ(t)、松弛模量 E(t)，正弦稳态段给出 E′、E″、tanδ。

技术栈：TypeScript · NestJS 10（Node.js 20）· Mongoose / MongoDB 7 · Jest。

## 本构与数值方法

广义 Maxwell（松弛型 Prony 级数）一维本构：

```
σ(t) = E∞·ε(t) + Σ_i E_i·q_i(t)
dq_i/dt + q_i/τ_i = dε/dt
```

- **逐步递推，无历史重卷积**：每个支路只维护当前内变量 q_i，每步 O(支路数)，
  整历程 O(步数 × 支路数)，对步数线性（见 `test/prony/complexity.spec.ts`）。
- **分段线性应变一步精确积分**：ε=e0+slope·(t−t_n)，
  `q_i^{n+1} = r·q_i^n + slope·τ_i(1−r)`，r=exp(−h/τ_i)。
- **正弦段一步精确积分**：正弦强迫下内变量的复系数闭式更新（含小幅值防相消处理），
  单大步与细分多小步结果一致。
- **段边界事件链**：段边界、折线拐点、输出网格点合并排序推进，混合段（线性+正弦）
  也能精确跨段。
- **松弛模量**：E(t)=E∞+ΣE_i·exp(−t/τ_i)。
- **动态模量（解析）**：
  E′(ω)=E∞+ΣE_i(ωτ_i)²/(1+(ωτ_i)²)，
  E″(ω)=ΣE_i·ωτ_i/(1+(ωτ_i)²)，tanδ=E″/E′。
  单正弦历程另做端到端稳态数值拟合（预热 ≥20·f·τmax 后取末周期）与解析值互校。
- **WLF**：log10(aT)=−C1(T−Tref)/(C2+T−Tref)，τ(T)=aT·τref。T>Tref ⇒ aT<1，松弛加快。

## 目录结构（按职责分模块，内核不在控制器里）

```
src/
  core/        领域类型、错误、分析编排（analysis.service）、异常过滤器
  prony/       Prony 递推内核（prony.kernel.ts）
  dynamic/     动态模量 E′/E″/tanδ（解析 + 周期拟合）
  tts/         WLF 时温等效
  history/     历程解析（校验、段拼接、输出网格）
  materials/   材料档：schema / dto / service / controller
  jobs/        作业：schema / dto / 调度 service（异步+历程级失败隔离）/ controller
test/          Jest 测试（67 个用例）
```

## 启动

```bash
docker compose up --build
# app  http://localhost:3000   mongo localhost:27017（命名卷 prony-mongo-data）
```

本地开发：`npm install && npm run test`，`MONGO_URI=mongodb://localhost:27017/prony npm run start:dev`。

## HTTP 接口

### 材料档
- `POST /materials`
  ```json
  {
    "name": "NBR-70",
    "description": "丁腈橡胶 70 度",
    "eInf": 2.0,
    "branches": [
      { "E": 3.0, "tau": 1.0 },
      { "E": 1.5, "tau": 10.0 }
    ],
    "wlf": { "tRef": 20, "c1": 17.44, "c2": 51.6 }
  }
  ```
  响应回显 `e0 = E∞ + ΣE_i`。
- `GET /materials`、`GET /materials/:id`、`PUT /materials/:id`、`DELETE /materials/:id`

### 作业
- `POST /jobs` —— 异步提交，立即返回 `{ jobId, status: "queued" }`
  ```json
  {
    "materialId": "<材料档 id>",
    "histories": [
      {
        "name": "step-hold",
        "segments": [
          { "kind": "linear", "points": [ { "t": 0, "strain": 0.05 } ] },
          { "kind": "linear", "points": [
              { "t": 0, "strain": 0.05 },
              { "t": 60, "strain": 0.05 } ] }
        ],
        "temperature": 23,
        "output": { "tStart": 0, "tEnd": 60, "count": 301 }
      },
      {
        "name": "sine-dma",
        "segments": [
          { "kind": "sine", "amplitude": 0.001, "frequency": 1.0,
            "cycles": 40, "pointsPerCycle": 256 }
        ],
        "output": { "tStart": 0, "tEnd": 40, "count": 1281 }
      }
    ]
  }
  ```
  - 阶跃：第一段用单个点 `{t:0,strain:ε0}`（零长锚点），后接保持段。
  - 斜坡/多段线性：控制点时间严格递增；后续段从段内 t=0 开始，相邻段应变必须连续。
  - 正弦段：`strain = offset + A·sin(2πf·s)`，整周期数结束；不写 offset 时自动接上段终点。
  - `temperature` 缺省为材料档 WLF 参考温度（不平移）。
- `GET /jobs/:id/progress` —— 进度（total/completed/succeeded/failed/percent）
- `GET /jobs/:id` —— 完整结果（每条历程含 time/strain/stress/relaxationModulus，
  正弦段含 dynamicModulus；失败的历程带 `error` 中文原因）
- `GET /jobs?materialId=<id>` —— 按材料档检索历史作业（最近优先）

### 健康检查
- `GET /health`

## 校验规则（均返回 400 并附中文原因；作业内则写入该条历程的 error）

| 规则 | 触发条件 |
| --- | --- |
| τ_i > 0 | `τ_i ≤ 0` |
| E_i ≥ 0 | `E_i < 0` |
| E∞ ≥ 0 | `E∞ < 0` |
| 控制点时间严格递增 | 相等或回退 |
| 正弦频率 > 0 | `frequency ≤ 0` |
| 正弦周期数 > 0 | `cycles ≤ 0` |
| WLF C2 > 0 | `C2 ≤ 0` |
| WLF 分母为正 | `C2 + T − Tref ≤ 0` |
| 输出网格在历程内 | tStart<0、tEnd>历程总时长、tEnd≤tStart |
| 材料档必须有 WLF | 指定了 temperature 但档里没有 WLF |
| 段衔接应变连续 | 相邻段起点/终点应变不一致 |

## 测试

```bash
npm test          # 67 个用例
npm run test:cov  # 覆盖率
```

覆盖的关键性质（`test/prony/`）：

1. 阶跃 ε0 下 σ(t)=E(t)·ε0，t≫τmax 趋于 E∞·ε0；
2. 无支路退化为线弹性 σ=E∞·ε；
3. 两历程应变相加 ⇒ 应力相加（线性叠加）；
4. 历程时间平移 ⇒ 应力平移；
5. τ 与时间轴同乘 k ⇒ 应力曲线按时间缩放不变；
6. 单支路 t=τ 时支路贡献剩初值的 e⁻¹（**可手算算例**，见下）；
7. 输出网格加密一倍，同一时刻应力变化 < 容差；
8. 正弦稳态 E′、E″、tanδ 与 Prony 解析公式一致（数值拟合互校）；
9. T>Tref 时 aT<1、应力松弛更快；WLF 单调性；
10. 计算量随步数线性（2k→8k、10k→40k 步计时）；
11. 全部非法输入的错误原因。

手算单支路算例（`test/prony/prony.kernel.spec.ts`）：
E∞=2、E1=3、τ1=1、ε0=0.05 ⇒ σ(t)=0.1+0.15·e⁻ᵗ，σ(0)=0.25，
σ(τ)=0.1+0.15/e，σ→0.1。

## 作业执行语义

- 提交即落库（`queued`）返回作业号，后台 `setImmediate` 异步执行；
- 逐条历程独立 try/catch：**某条失败只标该条 `failed` 并附原因，其余照算**；
  作业在有至少一条成功时标 `completed`，全失败标 `failed`；
- 每完成一条立即落库，进度查询实时反映 `histories[].status`。
