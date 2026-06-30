import bcrypt from 'bcryptjs';
import { PasswordHistoryService } from '../PasswordHistoryService';
import { prisma } from '../../lib/prisma';

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: {
    compare: jest.fn(),
    hash: jest.fn(),
  },
}));

jest.mock('../../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    passwordHistory: {
      findMany: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

describe('PasswordHistoryService', () => {
  const mockedPrisma = prisma as any;
  const mockedBcrypt = bcrypt as any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2024-01-15T00:00:00.000Z').getTime());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports rotation as required when a password is older than 90 days', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      lastPasswordChange: new Date('2023-09-10T00:00:00.000Z'),
    });

    await expect(PasswordHistoryService.isRotationRequired('user-1')).resolves.toBe(true);
    expect(mockedPrisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
  });

  it('detects reused passwords by comparing against recent password history', async () => {
    mockedPrisma.passwordHistory.findMany.mockResolvedValue([
      { hash: 'old-hash-1' },
      { hash: 'old-hash-2' },
    ]);
    mockedBcrypt.compare
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(PasswordHistoryService.isPasswordReused('user-1', 'new-password')).resolves.toBe(true);
    expect(mockedBcrypt.compare).toHaveBeenNthCalledWith(2, 'new-password', 'old-hash-2');
  });

  it('records a password change and prunes old history entries', async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'old-hash',
    });
    mockedPrisma.passwordHistory.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'entry-1' },
        { id: 'entry-2' },
        { id: 'entry-3' },
        { id: 'entry-4' },
        { id: 'entry-5' },
        { id: 'entry-6' },
      ]);

    await PasswordHistoryService.recordPasswordChange('user-1', 'new-hash');

    expect(mockedPrisma.passwordHistory.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', hash: 'old-hash' },
    });
    expect(mockedPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        passwordHash: 'new-hash',
        lastPasswordChange: expect.any(Date),
      },
    });
    expect(mockedPrisma.passwordHistory.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['entry-5', 'entry-6'] } },
    });
  });

  it('hashes passwords using bcrypt', async () => {
    mockedBcrypt.hash.mockResolvedValue('hashed-password');

    await expect(PasswordHistoryService.hashPassword('plain-password')).resolves.toBe('hashed-password');
    expect(mockedBcrypt.hash).toHaveBeenCalledWith('plain-password', 12);
  });
});
