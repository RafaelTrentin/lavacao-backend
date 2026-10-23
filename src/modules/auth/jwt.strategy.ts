
import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

type JwtPayload = {
  sub: string;
  email: string;
  role: string;
  businessId: string;
  tokenVersion?: number;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
    });
  }

  async validate(payload: JwtPayload) {
    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      !payload.sub
    ) {
      throw new UnauthorizedException('Sessão inválida');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        businessId: true,
        tokenVersion: true,
        isActive: true,
        deletedAt: true,
        business: {
          select: {
            isActive: true,
            deletedAt: true,
          },
        },
      },
    });

    if (
      !user ||
      !user.isActive ||
      user.deletedAt !== null ||
      !user.business?.isActive ||
      user.business.deletedAt !== null
    ) {
      throw new UnauthorizedException('Sessão inválida');
    }

    // Tokens emitidos antes da migração não possuem
    // tokenVersion. São tratados como versão zero.
    const receivedVersion = payload.tokenVersion ?? 0;

    if (
      !Number.isInteger(receivedVersion) ||
      receivedVersion !== user.tokenVersion
    ) {
      throw new UnauthorizedException(
        'Sessão encerrada. Faça login novamente.',
      );
    }

    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      businessId: user.businessId,
    };
  }
}
