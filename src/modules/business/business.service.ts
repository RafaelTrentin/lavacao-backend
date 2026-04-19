import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { UpdateBusinessSettingsDto } from './dto/update-business-settings.dto';
import { MapsService } from '../maps/maps.service';
import { GeocodeAddressDto } from '../maps/dto/geocode-address.dto';

@Injectable()
export class BusinessService {
  constructor(
    private prisma: PrismaService,
    private mapsService: MapsService,
  ) {}

  buildUploadUrl(fileName: string) {
    const baseUrl =
      process.env.API_URL ||
      process.env.BASE_URL ||
      `http://localhost:${process.env.PORT || 3000}`;

    return `${baseUrl.replace(/\/$/, '')}/uploads/${fileName}`;
  }

  async getBusinessById(businessId: string) {
    const business = await this.prisma.business.findUnique({
      where: { id: businessId },
      include: {
        branding: true,
        settings: true,
        businessAddress: true,
      },
    });

    if (!business) {
      throw new NotFoundException('Negócio não encontrado');
    }

    return business;
  }

  async updateBusinessSettings(
    businessId: string,
    updateBusinessSettingsDto: UpdateBusinessSettingsDto,
  ) {
    await this.getBusinessById(businessId);

    const {
      operatingHoursJson,
      searchFeeUpTo5km,
      searchFeeOver5km,
      searchFeeLimitKm,
      whatsappPhone,
      minimumAdvanceMinutes,
    } = updateBusinessSettingsDto;

    return this.prisma.businessSettings.update({
      where: { businessId },
      data: {
        ...(operatingHoursJson && { operatingHours: operatingHoursJson }),
        ...(searchFeeUpTo5km !== undefined && { searchFeeUpTo5km }),
        ...(searchFeeOver5km !== undefined && { searchFeeOver5km }),
        ...(searchFeeLimitKm !== undefined && {
          searchFeeLimitKm: new Prisma.Decimal(searchFeeLimitKm),
        }),
        ...(whatsappPhone !== undefined && { whatsappPhone }),
        ...(minimumAdvanceMinutes !== undefined && {
          minimumAdvanceMinutes,
        }),
      },
    });
  }

  async updateBusinessBranding(
    businessId: string,
    updateBrandingData: {
      logoUrl?: string;
      iconUrl?: string;
      primaryColor?: string;
      secondaryColor?: string;
      accentColor?: string;
    },
  ) {
    await this.getBusinessById(businessId);

    return this.prisma.businessBranding.update({
      where: { businessId },
      data: updateBrandingData,
    });
  }

  async updateBusinessAddress(
    businessId: string,
    updateAddressData: {
      streetAddress?: string;
      number?: string;
      complement?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      latitude?: number;
      longitude?: number;
    },
  ) {
    const business = await this.getBusinessById(businessId);

    if (!business.businessAddress) {
      throw new NotFoundException('Endereço da empresa não encontrado');
    }

    return this.prisma.businessAddress.update({
      where: { businessId },
      data: {
        ...updateAddressData,
        ...(updateAddressData.latitude !== undefined && {
          latitude: new Prisma.Decimal(updateAddressData.latitude),
        }),
        ...(updateAddressData.longitude !== undefined && {
          longitude: new Prisma.Decimal(updateAddressData.longitude),
        }),
      },
    });
  }

  async getBusinessSettings(businessId: string) {
    const settings = await this.prisma.businessSettings.findUnique({
      where: { businessId },
    });

    if (!settings) {
      throw new NotFoundException('Configurações do negócio não encontradas');
    }

    return settings;
  }

  async getBusinessBranding(businessId: string) {
    const branding = await this.prisma.businessBranding.findUnique({
      where: { businessId },
    });

    if (!branding) {
      throw new NotFoundException('Branding do negócio não encontrado');
    }

    return branding;
  }

  async getBusinessAddress(businessId: string) {
    const address = await this.prisma.businessAddress.findUnique({
      where: { businessId },
    });

    if (!address) {
      throw new NotFoundException('Endereço da empresa não encontrado');
    }

    return address;
  }

  async getAllBusinesses() {
    return this.prisma.business.findMany({
      where: { isActive: true, deletedAt: null },
      include: {
        branding: true,
        settings: true,
        businessAddress: true,
      },
    });
  }

  async createBusiness(createBusinessDto: CreateBusinessDto) {
    const { name, slug, timezone } = createBusinessDto;
    const normalizedSlug = slug.trim().toLowerCase();

    const existingSlug = await this.prisma.business.findUnique({
      where: { slug: normalizedSlug },
    });

    if (existingSlug) {
      throw new BadRequestException('Slug já está em uso');
    }

    return this.prisma.business.create({
      data: {
        name,
        slug: normalizedSlug,
        timezone,
        branding: {
          create: {
            primaryColor: '#0066CC',
            secondaryColor: '#FF6B35',
            accentColor: '#00D4FF',
          },
        },
        settings: {
          create: {
            operatingHours: {
              SUNDAY: null,
              MONDAY: { open: '08:00', close: '18:00' },
              TUESDAY: { open: '08:00', close: '18:00' },
              WEDNESDAY: { open: '08:00', close: '18:00' },
              THURSDAY: { open: '08:00', close: '18:00' },
              FRIDAY: { open: '08:00', close: '18:00' },
              SATURDAY: { open: '08:00', close: '14:00' },
            },
            searchFeeUpTo5km: 500,
            searchFeeOver5km: 1000,
            searchFeeLimitKm: new Prisma.Decimal('5.00'),
          },
        },
        businessAddress: {
          create: {
            streetAddress: 'Avenida Paulista',
            number: '1000',
            neighborhood: 'Bela Vista',
            city: 'São Paulo',
            state: 'SP',
            zipCode: '01311-100',
            latitude: new Prisma.Decimal('-23.5505'),
            longitude: new Prisma.Decimal('-46.6333'),
          },
        },
      },
      include: {
        branding: true,
        settings: true,
        businessAddress: true,
      },
    });
  }

  async deactivateBusiness(businessId: string) {
    await this.getBusinessById(businessId);

    return this.prisma.business.update({
      where: { id: businessId },
      data: { isActive: false },
    });
  }

  async activateBusiness(businessId: string) {
    await this.getBusinessById(businessId);

    return this.prisma.business.update({
      where: { id: businessId },
      data: { isActive: true },
    });
  }

  async geocodeBusinessAddress(address: GeocodeAddressDto) {
    return this.mapsService.geocodeAddress(address);
  }

  async getPublicBusinessBySlug(slug: string) {
    const normalizedSlug = slug.trim().toLowerCase();

    const business = await this.prisma.business.findFirst({
      where: {
        slug: normalizedSlug,
        isActive: true,
        deletedAt: null,
      },
      include: {
        branding: true,
      },
    });

    if (!business) {
      return null;
    }

    return {
      id: business.id,
      name: business.name,
      slug: business.slug,
      logoUrl: business.branding?.logoUrl || null,
      iconUrl: business.branding?.iconUrl || null,
      primaryColor: business.branding?.primaryColor || '#0066CC',
      secondaryColor: business.branding?.secondaryColor || '#FF6B35',
      accentColor: business.branding?.accentColor || '#00D4FF',
    };
  }
}