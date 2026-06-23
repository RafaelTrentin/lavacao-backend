import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  NotFoundException,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { fileTypeFromBuffer } from 'file-type';

import { JwtGuard } from 'src/common/guards/jwt.guard';
import { AdminGuard } from 'src/common/guards/admin.guard';
import {
  CurrentUser,
  CurrentUserPayload,
} from 'src/common/decorators/current-user.decorator';
import {
  sanitizeCloudinaryName,
  uploadImageBufferToCloudinary,
} from 'src/common/storage/cloudinary-upload';

import { ExtraServicesService } from './extra-services.service';
import { CreateExtraServiceDto } from './dto/create-extra-service.dto';
import { CreateExtraServiceRequestDto } from './dto/create-extra-service-request.dto';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateExtraServiceDto } from './dto/update-extra-service.dto';

const MAX_FILE_SIZE = 4 * 1024 * 1024;

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_REAL_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

@Controller('extra-services')
@UseGuards(JwtGuard)
export class ExtraServicesController {
  constructor(
    private extraServicesService: ExtraServicesService,
    private prisma: PrismaService,
  ) {}

  @Get()
  async getAll(@CurrentUser() user: CurrentUserPayload) {
    return this.extraServicesService.getExtraServicesByBusiness(
      user.businessId,
      user.role === 'ADMIN',
    );
  }

  @Post('requests')
  async createRequest(
    @Body() createRequestDto: CreateExtraServiceRequestDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const customerProfile = await this.prisma.customerProfile.findUnique({
      where: { userId: user.userId },
    });

    if (!customerProfile) {
      throw new NotFoundException('Perfil de cliente não encontrado');
    }

    return this.extraServicesService.createExtraServiceRequest(
      user.businessId,
      customerProfile.id,
      createRequestDto,
    );
  }

  @Get('requests')
  @UseGuards(AdminGuard)
  async getRequests(@CurrentUser() user: CurrentUserPayload) {
    return this.extraServicesService.getExtraServiceRequests(user.businessId);
  }

  @Post('upload-image')
  @UseGuards(AdminGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_FILE_SIZE,
        files: 1,
      },
      fileFilter: (req, file, callback) => {
        const mimeType = (file.mimetype || '').toLowerCase();

        if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
          return callback(
            new BadRequestException(
              'Arquivo inválido. Envie apenas imagens JPG, PNG ou WEBP.',
            ),
            false,
          );
        }

        callback(null, true);
      },
    }),
  )
  async uploadExtraServiceImage(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo não enviado');
    }

    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Arquivo inválido ou vazio');
    }

    const detectedType = await fileTypeFromBuffer(file.buffer);

    if (!detectedType) {
      throw new BadRequestException(
        'Não foi possível identificar o tipo real do arquivo',
      );
    }

    if (
      !ALLOWED_MIME_TYPES.includes(detectedType.mime) ||
      !ALLOWED_REAL_EXTENSIONS.includes(detectedType.ext)
    ) {
      throw new BadRequestException(
        'Arquivo inválido. O conteúdo enviado não corresponde a uma imagem permitida.',
      );
    }

    const baseName =
      sanitizeCloudinaryName(file.originalname) || 'servico-extra';

    const publicId = `${Date.now()}-${Math.round(
      Math.random() * 1e9,
    )}-${baseName}`;

    const uploaded = await uploadImageBufferToCloudinary({
      buffer: file.buffer,
      folder: `washsync/businesses/${user.businessId}/extra-services`,
      publicId,
    });

    return {
      url: uploaded.secure_url,
      filename: uploaded.public_id,
      publicId: uploaded.public_id,
      contentType: detectedType.mime,
      size: file.size,
      businessId: user.businessId,
    };
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(
    @Body() createExtraServiceDto: CreateExtraServiceDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.extraServicesService.createExtraService(
      user.businessId,
      createExtraServiceDto,
    );
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id') serviceId: string,
    @Body() updateExtraServiceDto: UpdateExtraServiceDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.extraServicesService.updateExtraService(
      serviceId,
      user.businessId,
      updateExtraServiceDto,
    );
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  async delete(
    @Param('id') serviceId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.extraServicesService.deleteExtraService(
      serviceId,
      user.businessId,
    );
  }

  @Put('requests/:id/status')
  @UseGuards(AdminGuard)
  async updateRequestStatus(
    @Param('id') requestId: string,
    @Body() statusData: { status: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.extraServicesService.updateExtraServiceRequestStatus(
      requestId,
      user.businessId,
      statusData.status,
    );
  }
}