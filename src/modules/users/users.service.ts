import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: {
        adminProfile: true,
        customerProfile: true,
      },
    });
  }

  async findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email },
    });
  }

  async getUsersByBusiness(businessId: string) {
    return this.prisma.user.findMany({
      where: {
        businessId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        adminProfile: true,
        customerProfile: true,
      },
    });
  }
}