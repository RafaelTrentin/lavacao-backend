import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Hash das senhas
  const adminPasswordHash = await bcrypt.hash('123456', 10);
  const customerPasswordHash = await bcrypt.hash('123456', 10);

  // Business
  const business = await prisma.business.create({
    data: {
      name: 'Lavacao Teste',
      slug: 'lavacao-teste',
      timezone: 'America/Sao_Paulo',
      settings: {
        create: {
          operatingHours: {
            MONDAY: { open: '08:00', close: '18:00' },
            TUESDAY: { open: '08:00', close: '18:00' },
            WEDNESDAY: { open: '08:00', close: '18:00' },
            THURSDAY: { open: '08:00', close: '18:00' },
            FRIDAY: { open: '08:00', close: '18:00' },
            SATURDAY: { open: '08:00', close: '12:00' },
          },
          nonOperatingDates: [],
          minimumAdvanceMinutes: 15,
          searchFeeUpTo5km: 500,
          searchFeeOver5km: 1000,
          whatsappPhone: '49999999999',
        },
      },
      businessAddress: {
        create: {
          streetAddress: 'Rua Exemplo',
          number: '123',
          neighborhood: 'Centro',
          city: 'Chapecó',
          state: 'SC',
          zipCode: '89800-000',
          country: 'BR',
          latitude: -27.1004,
          longitude: -52.6152,
        },
      },
      branding: {
        create: {
          primaryColor: '#0066CC',
          secondaryColor: '#FF6B35',
          accentColor: '#00D4FF',
        },
      },
    },
  });

  // Usuário admin
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@teste.com',
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN,
      businessId: business.id,
      adminProfile: {
        create: {
          name: 'Administrador',
        },
      },
    },
  });

  // Usuário cliente
  const customerUser = await prisma.user.create({
    data: {
      email: 'cliente@teste.com',
      passwordHash: customerPasswordHash,
      role: UserRole.CUSTOMER,
      businessId: business.id,
      customerProfile: {
        create: {
          businessId: business.id,
          name: 'Cliente Teste',
          phone: '49999999998',
          preferredContactMethod: 'WHATSAPP',
        },
      },
    },
  });

  // Tipos de veículo
  const car = await prisma.vehicleType.create({
    data: {
      displayName: 'Carro',
      kind: 'CAR',
    },
  });

  const motorcycle = await prisma.vehicleType.create({
    data: {
      displayName: 'Moto',
      kind: 'MOTORCYCLE',
    },
  });

  // Modalidade 1
  const classica = await prisma.serviceMode.create({
    data: {
      name: 'Clássica',
      description: 'Lavagem básica e eficiente',
      businessId: business.id,
      isActive: true,
      displayOrder: 1,
      rules: {
        create: [
          {
            vehicleTypeId: car.id,
            durationMinutes: 40,
            basePriceInCents: 5000,
          },
          {
            vehicleTypeId: motorcycle.id,
            durationMinutes: 20,
            basePriceInCents: 3000,
          },
        ],
      },
    },
  });

  // Modalidade 2
  await prisma.serviceMode.create({
    data: {
      name: 'Detalhada',
      description: 'Limpeza mais completa',
      businessId: business.id,
      isActive: true,
      displayOrder: 2,
      rules: {
        create: [
          {
            vehicleTypeId: car.id,
            durationMinutes: 60,
            basePriceInCents: 8000,
          },
          {
            vehicleTypeId: motorcycle.id,
            durationMinutes: 40,
            basePriceInCents: 5000,
          },
        ],
      },
    },
  });

  // Modalidade 3
  await prisma.serviceMode.create({
    data: {
      name: 'Premium',
      description: 'Serviço premium completo',
      businessId: business.id,
      isActive: true,
      displayOrder: 3,
      rules: {
        create: [
          {
            vehicleTypeId: car.id,
            durationMinutes: 120,
            basePriceInCents: 15000,
          },
          {
            vehicleTypeId: motorcycle.id,
            durationMinutes: 90,
            basePriceInCents: 10000,
          },
        ],
      },
    },
  });

  // Serviços extras
  await prisma.extraService.createMany({
    data: [
      {
        businessId: business.id,
        name: 'Polimento',
        description: 'Polimento técnico da pintura',
        estimatedPriceInCents: 20000,
        isActive: true,
        displayOrder: 1,
        serviceModeId: classica.id,
      },
      {
        businessId: business.id,
        name: 'Higienização',
        description: 'Higienização interna completa',
        estimatedPriceInCents: 18000,
        isActive: true,
        displayOrder: 2,
      },
      {
        businessId: business.id,
        name: 'Cristalização',
        description: 'Proteção e brilho prolongado',
        estimatedPriceInCents: 25000,
        isActive: true,
        displayOrder: 3,
      },
      {
        businessId: business.id,
        name: 'Enceramento',
        description: 'Acabamento com cera especial',
        estimatedPriceInCents: 12000,
        isActive: true,
        displayOrder: 4,
      },
    ],
  });

  console.log('✅ Seed executado com sucesso!');
  console.log('📧 Admin:', adminUser.email);
  console.log('🔑 Senha admin: 123456');
  console.log('👤 Cliente:', customerUser.email);
  console.log('🔑 Senha cliente: 123456');
  console.log('🏢 Business:', business.name);
}

main()
  .catch((e) => {
    console.error('❌ Erro ao executar seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });