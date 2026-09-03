import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Source } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { sanitizeSourceConfig } from './sanitize-config';
import type { CreateSourceDto, SourceResponse } from './types';

@Injectable()
export class SourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSourceDto): Promise<SourceResponse> {
    const source = await this.prisma.source.create({
      data: {
        name: dto.name,
        type: dto.type,
        config: dto.config as Prisma.InputJsonValue,
      },
    });
    return this.toResponse(source);
  }

  async findOne(id: string): Promise<SourceResponse> {
    const source = await this.prisma.source.findUnique({ where: { id } });
    if (!source) {
      throw new NotFoundException(`Source ${id} not found`);
    }
    return this.toResponse(source);
  }

  private toResponse(source: Source): SourceResponse {
    return {
      id: source.id,
      name: source.name,
      type: source.type,
      config: sanitizeSourceConfig(source.config),
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    };
  }
}
