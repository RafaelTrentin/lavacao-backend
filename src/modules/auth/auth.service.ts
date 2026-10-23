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
import { randomBytes, createHash } from 'node:crypto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
  private prisma: PrismaService,
  private jwtService: JwtService,
  private mailService: MailService,
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
  tokenVersion: user.tokenVersion,
};

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET!,
      expiresIn: (process.env.JWT_EXPIRATION || '24h') as any,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_REFRESH_SECRET!,
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
        secret: process.env.JWT_REFRESH_SECRET!,
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


  async forgotPassword(
    email: string,
    businessSlug: string,
  ): Promise<{ message: string }> {
    const genericResponse = {
      message:
        'Se existir uma conta vinculada a este e-mail, você receberá instruções de recuperação.',
    };

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
      return genericResponse;
    }

    const user = await this.prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        businessId: business.id,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!user) {
      return genericResponse;
    }

    const recentReset = await this.prisma.passwordResetToken.findFirst({
  where: {
    userId: user.id,
    createdAt: {
      gt: new Date(Date.now() - 5 * 60 * 1000),
    },
  },
  select: {
    id: true,
  },
});

if (recentReset) {
  return genericResponse;
}

    const resetBaseUrl = process.env.PASSWORD_RESET_URL;

    if (!resetBaseUrl) {
      throw new Error('PASSWORD_RESET_URL nao configurada');
    }

    const token = randomBytes(32).toString('hex');

    const tokenHash = createHash('sha256')
      .update(token)
      .digest('hex');

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const resetRecord = await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    const resetUrl = new URL(resetBaseUrl);
    resetUrl.searchParams.set('token', token);

    try {
      await this.mailService.sendPasswordResetEmail(
        user.email,
        resetUrl.toString(),
      );
    } catch {
      await this.prisma.passwordResetToken.deleteMany({
        where: { id: resetRecord.id },
      });

      // Nao revelar se o e-mail esta cadastrado.
      return genericResponse;
    }

    return genericResponse;
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    const tokenHash = createHash('sha256')
      .update(token)
      .digest('hex');

    const now = new Date();

    const resetRecord =
      await this.prisma.passwordResetToken.findUnique({
        where: { tokenHash },
      });

    if (
      !resetRecord ||
      resetRecord.usedAt ||
      resetRecord.expiresAt <= now
    ) {
      throw new BadRequestException(
        'Link de recuperacao invalido ou expirado.',
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.passwordResetToken.updateMany({
        where: {
          id: resetRecord.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          usedAt: new Date(),
        },
      });

      if (consumed.count !== 1) {
        throw new BadRequestException(
          'Link de recuperacao ja utilizado ou expirado.',
        );
      }

      const updated = await tx.user.updateMany({
        where: {
          id: resetRecord.userId,
          isActive: true,
          deletedAt: null,
          business: {
            isActive: true,
            deletedAt: null,
          },
        },
data: {
  passwordHash,
  tokenVersion: {
    increment: 1,
  },
},
      });

      if (updated.count !== 1) {
        throw new BadRequestException(
          'Conta indisponivel para recuperacao.',
        );
      }

      await tx.passwordResetToken.updateMany({
        where: {
          userId: resetRecord.userId,
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          userId: resetRecord.userId,
          isRevoked: false,
        },
        data: {
          isRevoked: true,
        },
      });
    });

    return {
      message:
        'Senha redefinida com sucesso. Faca login novamente.',
    };
  }


}