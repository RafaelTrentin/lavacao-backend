import { NestFactory } from '@nestjs/core';
import {
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as fs from 'fs';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';

async function bootstrap() {
  const requiredSecrets = ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;

  for (const key of requiredSecrets) {
    const value = process.env[key];

    if (!value || !value.trim()) {
      throw new Error(
        `Configuracao obrigatoria ausente: ${key}`,
      );
    }
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const uploadsPath = join(process.cwd(), 'uploads');

  if (!fs.existsSync(uploadsPath)) {
    fs.mkdirSync(uploadsPath, { recursive: true });
  }

  app.useStaticAssets(uploadsPath, {
    prefix: '/uploads/',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        return new BadRequestException(errors);
      },
    }),
  );

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message:
        'Muitas tentativas realizadas. Aguarde alguns minutos e tente novamente.',
    },
  });

  const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      message:
        'Muitas tentativas de renovação de sessão. Aguarde alguns minutos.',
    },
  });

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message:
      'Muitas solicitações de recuperação. Aguarde 15 minutos e tente novamente.',
  },
});

  app.use('/auth/login', authLimiter);
  app.use('/auth/signup', authLimiter);
  app.use('/auth/refresh', refreshLimiter);

  app.use('/auth/forgot-password', passwordResetLimiter);
  app.use('/auth/reset-password', passwordResetLimiter);

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`✓ Application is running on: http://localhost:${port}`);
}

bootstrap().catch((err) => {
  console.error('✗ Bootstrap failed:', err);
  process.exit(1);
});