import { Prisma } from '@prisma/client';

// Allowlist shared by all customer HTTP responses. Never return a complete User.
export const customerResponseSelect = {
  id: true,
  userId: true,
  businessId: true,
  name: true,
  phone: true,
  documentNumber: true,
  preferredContactMethod: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: { id: true, email: true, role: true, businessId: true },
  },
  addresses: {
    select: {
      id: true,
      businessId: true,
      customerId: true,
      streetAddress: true,
      number: true,
      complement: true,
      neighborhood: true,
      city: true,
      state: true,
      zipCode: true,
      country: true,
      latitude: true,
      longitude: true,
      addressType: true,
      isDefault: true,
      label: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.CustomerProfileSelect;
