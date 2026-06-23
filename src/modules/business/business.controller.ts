import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
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

import { BusinessService } from './business.service';
import { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';
import { UpdateBusinessBrandingDto } from './dto/update-business-branding.dto';
import { UpdateBusinessAddressDto } from './dto/update-business-address.dto';
import { GeocodeAddressDto } from '../maps/dto/geocode-address.dto';

const MAX_FILE_SIZE = 2 * 1024 * 1024;

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_REAL_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

@Controller('business')
@UseGuards(JwtGuard)
export class BusinessController {
  constructor(private businessService: BusinessService) {}

  @Get()
  async getBusinessInfo(@CurrentUser() user: CurrentUserPayload) {
    return this.businessService.getBusinessById(user.businessId);
  }

  @Get('settings')
  async getSettings(@CurrentUser() user: CurrentUserPayload) {
    return this.businessService.getBusinessSettings(user.businessId);
  }

  @Get('branding')
  async getBranding(@CurrentUser() user: CurrentUserPayload) {
    return this.businessService.getBusinessBranding(user.businessId);
  }

  @Get('address')
  async getAddress(@CurrentUser() user: CurrentUserPayload) {
    return this.businessService.getBusinessAddress(user.businessId);
  }

  @Put('settings')
  @UseGuards(AdminGuard)
  async updateSettings(
    @Body() updateBusinessSettingsDto: UpdateBusinessSettingsDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.businessService.updateBusinessSettings(
      user.businessId,
      updateBusinessSettingsDto,
    );
  }

  @Put('branding')
  @UseGuards(AdminGuard)
  async updateBranding(
    @Body() updateBrandingDto: UpdateBusinessBrandingDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.businessService.updateBusinessBranding(
      user.businessId,
      updateBrandingDto,
    );
  }

  @Put('address')
  @UseGuards(AdminGuard)
  async updateAddress(
    @Body() updateAddressDto: UpdateBusinessAddressDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.businessService.updateBusinessAddress(
      user.businessId,
      updateAddressDto,
    );
  }

  @Post('upload-logo')
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
  async uploadLogo(
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

    const baseName = sanitizeCloudinaryName(file.originalname) || 'logo';

    const publicId = `${Date.now()}-${Math.round(
      Math.random() * 1e9,
    )}-${baseName}`;

    const uploaded = await uploadImageBufferToCloudinary({
      buffer: file.buffer,
      folder: `washsync/businesses/${user.businessId}/branding`,
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

  @Post('geocode-address')
  @UseGuards(AdminGuard)
  async geocodeAddress(
    @Body() dto: GeocodeAddressDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.businessService.geocodeBusinessAddress(dto);
  }
}