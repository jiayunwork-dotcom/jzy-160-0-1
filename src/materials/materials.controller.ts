import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { MaterialsService } from './materials.service';
import { CreateMaterialDto, UpdateMaterialDto } from './materials.dto';

/** 材料档 REST 接口 */
@Controller('materials')
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Post()
  create(@Body() dto: CreateMaterialDto) {
    return this.materials.create(dto);
  }

  @Get()
  list() {
    return this.materials.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.materials.getById(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMaterialDto) {
    return this.materials.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string) {
    await this.materials.remove(id);
  }
}
