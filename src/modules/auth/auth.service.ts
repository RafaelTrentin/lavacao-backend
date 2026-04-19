import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { TokenDto } from './dto/token.dto';
import { UserRole } from 'src/common/enums';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async signup(signupDto: SignupDto): Promise<TokenDto> {
    const { email, password, name, phone, role, businessSlug } = signupDto;

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedSlug = businessSlug.trim().toLowerCase();

    const business = await this.prisma.business.findFirst({
      where: {
        slug: normalizedSlug,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!business) {
      throw new BadRequestException('Empresa não encontrada');
    }

    const existingUser = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        businessId: business.id,
      },
    });

    if (existingUser) {
      throw new BadRequestException('Email já registrado nesta empresa');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        role,
        businessId: business.id,
        isActive: true,
        ...(role === UserRole.ADMIN && {
          adminProfile: {
            create: { name },
          },
        }),
        ...(role === UserRole.CUSTOMER && {
          customerProfile: {
            create: {
              name,
              phone,
              businessId: business.id,
            },
          },
        }),
      },
      include: {
        adminProfile: true,
        customerProfile: true,
      },
    });

    return this.generateTokens(user.id);
  }

  async login(loginDto: LoginDto): Promise<TokenDto> {
    const { email, password, businessSlug } = loginDto;

    const normalizedEmail = email.trim().toLowerCase();

    let user = null;

    if (businessSlug?.trim()) {
      const normalizedSlug = businessSlug.trim().toLowerCase();

      const business = await this.prisma.business.findFirst({
        where: {
          slug: normalizedSlug,
          isActive: true,
          deletedAt: null,
        },
      });

      if (!business) {
        throw new UnauthorizedException('Empresa não encontrada');
      }

      user = await this.prisma.user.findFirst({
        where: {
          email: normalizedEmail,
          businessId: business.id,
        },
      });
    } else {
      user = await this.prisma.user.findFirst({
        where: {
          email: normalizedEmail,
          role: UserRole.ADMIN,
        },
      });
    }

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Credenciais inválidas');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.generateTokens(user.id);
  }

  async generateTokens(userId: string): Promise<TokenDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      businessId: user.businessId,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET || 'dev-secret-key',
      expiresIn: (process.env.JWT_EXPIRATION || '24h') as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-key',
      expiresIn: (process.env.JWT_REFRESH_EXPIRATION || '7d') as any,
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        isRevoked: false,
      },
      data: {
        isRevoked: true,
      },
    });

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: refreshTokenHash,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: 86400,
      tokenType: 'Bearer',
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenDto> {
    if (!refreshToken?.trim()) {
      throw new UnauthorizedException('Refresh token inválido');
    }

    try {
      const decoded = this.jwtService.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-key',
      });

      const storedTokens = await this.prisma.refreshToken.findMany({
        where: {
          userId: decoded.sub,
          isRevoked: false,
          expiresAt: {
            gt: new Date(),
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      let matchedToken: { id: string; token: string } | null = null;

      for (const storedToken of storedTokens) {
        const isMatch = await bcrypt.compare(refreshToken, storedToken.token);
        if (isMatch) {
          matchedToken = storedToken;
          break;
        }
      }

      if (!matchedToken) {
        throw new UnauthorizedException('Refresh token inválido');
      }

      await this.prisma.refreshToken.update({
        where: { id: matchedToken.id },
        data: { isRevoked: true },
      });

      return this.generateTokens(decoded.sub);
    } catch {
      throw new UnauthorizedException('Refresh token inválido');
    }
  }
}