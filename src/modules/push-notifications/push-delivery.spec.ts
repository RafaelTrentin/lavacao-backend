import { PushNotificationsService } from './push-notifications.service';
import * as webpush from 'web-push';

jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));

describe('Best effort external delivery', () => {
  beforeEach(() => jest.clearAllMocks());
  it.each(['ADMIN', 'CUSTOMER'])('derives the %s Web route and recipient, preserving native navigation', async (role) => {
    const db = {
      user: { findFirst: jest.fn(async () => ({ id: 'a', role })) },
      business: { findUnique: jest.fn(async () => ({ slug: 'wash-a' })) },
      pushSubscription: { findMany: jest.fn(async () => [{ endpoint: 'https://example.invalid/push', p256dh: 'p', auth: 'a' }]) },
      pushDevice: { findMany: jest.fn(async () => [{ id: 'd', token: 'fixture' }]) },
    };
    const firebase = { isAvailable: () => true, sendToDevice: jest.fn() };
    (webpush.sendNotification as jest.Mock).mockResolvedValue({});
    await new PushNotificationsService(db as any, firebase as any).sendToUser({ userId: 'a', businessId: 'wash', title: 'test', body: 'body', url: '/notifications' });
    const payload = JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1]);
    expect(payload).toMatchObject({ userId: 'a', businessId: 'wash', url: role === 'ADMIN' ? '/admin/notifications' : '/empresa/wash-a/notifications' });
    expect(firebase.sendToDevice).toHaveBeenCalledWith(expect.objectContaining({ url: '/notifications' }));
  });
  it('removes an expired 410 subscription only for its captured tenant and user', async () => {
    const db = {
      user: { findFirst: jest.fn(async () => ({ id: 'a', role: 'CUSTOMER' })) },
      business: { findUnique: jest.fn(async () => ({ slug: 'wash' })) },
      pushSubscription: {
        findMany: jest.fn(async () => [{ endpoint: 'https://example.invalid/expired', p256dh: 'p', auth: 'a' }]),
        deleteMany: jest.fn(),
      },
    };
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 410 });
    await new PushNotificationsService(db as any, { isAvailable: () => false } as any).sendToUser({ userId: 'a', businessId: 'wash', title: 'test', body: 'body', url: 'https://evil.test/' });
    expect(db.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { endpoint: 'https://example.invalid/expired', userId: 'a', businessId: 'wash' } });
    expect(JSON.parse((webpush.sendNotification as jest.Mock).mock.calls[0][1]).url).toBe('/empresa/wash/notifications');
  });
  it('attempts Web Push and FCM once even when both providers fail', async () => {
    const db = {
      business: { findUnique: jest.fn(async () => ({ slug: 'fixture' })) },
      user: { findFirst: jest.fn(async () => ({ id: 'user-a' })) },
      pushSubscription: { findMany: jest.fn(async () => [{ endpoint: 'https://example.invalid/push', p256dh: 'fixture', auth: 'fixture' }]) },
      pushDevice: { findMany: jest.fn(async () => [{ id: 'device-a', token: 'fixture' }]) },
    };
    const firebase = { isAvailable: () => true, sendToDevice: jest.fn().mockRejectedValue({ code: 'messaging/internal-error' }) };
    (webpush.sendNotification as jest.Mock).mockRejectedValue({ statusCode: 503 });
    const service = new PushNotificationsService(db as any, firebase as any);
    await expect(service.sendToUser({ businessId: 'a', userId: 'user-a', title: 'title', body: 'body', url: '/notifications' })).resolves.toBeUndefined();
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
    expect(firebase.sendToDevice).toHaveBeenCalledTimes(1);
    expect(firebase.sendToDevice).toHaveBeenCalledWith({ token: 'fixture', title: 'title', body: 'body', url: '/notifications' });
    expect(db.pushSubscription.findMany).toHaveBeenCalledWith({ where: { businessId: 'a', userId: 'user-a' } });
    expect(db.pushDevice.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: 'a', userId: 'user-a', isActive: true }) }));
  });
});
