import { Request, Response, NextFunction } from 'express';
import { ipWhitelistMiddleware } from '../middleware/ipWhitelist';
import * as runtime from '../config/runtime';
import requestIp from 'request-ip';

jest.mock('../config/runtime');
jest.mock('request-ip');
jest.mock('../lib/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  }),
}));

describe('ipWhitelistMiddleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction = jest.fn();

  beforeEach(() => {
    mockRequest = {
      path: '/api/v1/health',
      method: 'GET',
      headers: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    (nextFunction as jest.Mock).mockClear();
    jest.clearAllMocks();
  });

  it('should allow access if whitelist is empty', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue([]);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('127.0.0.1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should allow access if client IP matches an exact entry', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['127.0.0.1', '192.168.1.1']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('192.168.1.1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should allow access if client IP matches a CIDR range', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['192.168.1.0/24']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('192.168.1.50');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should allow access for IPv6 addresses', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['2001:db8::/32']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('2001:db8:85a3::8a2e:370:7334');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should block access if client IP is not whitelisted', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['127.0.0.1', '10.0.0.0/8']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('192.168.1.1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    
    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith({
      error: 'Access forbidden: Your IP address is not authorized to access this endpoint.'
    });
  });

  it('should block access and return 403 if client IP cannot be determined', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['127.0.0.1']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue(null);

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
  });

  it('should skip invalid CIDR entries in the whitelist', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['invalid-ip', '127.0.0.1']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('127.0.0.1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  // ── IPv4-mapped IPv6 address tests ────────────────────────────────────────

  it('should allow access for IPv4-mapped IPv6 address matching an exact IPv4 whitelist entry', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['192.168.1.1']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('::ffff:192.168.1.1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should allow access for IPv4-mapped IPv6 address matching an IPv4 CIDR whitelist entry', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['192.168.1.0/24']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('::ffff:192.168.1.50');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should block access for IPv4-mapped IPv6 address not in the whitelist', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['10.0.0.1']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('::ffff:192.168.1.1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
  });

  it('should allow access for IPv4-mapped IPv6 address matching a mixed whitelist (IPv4 + IPv6)', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['127.0.0.1', '::1', '192.168.1.0/24']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('::ffff:192.168.1.100');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('should handle case-insensitive IPv4-mapped IPv6 prefix', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['192.168.1.1']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('::FFFF:192.168.1.1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });
});

// ── CIDR range matching — edge cases ─────────────────────────────────────────

describe('ipWhitelistMiddleware — CIDR range matching', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = { path: '/admin', method: 'GET', headers: {} };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
    jest.clearAllMocks();
  });

  it('allows the network address of a /24 CIDR range', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['10.0.0.0/24']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('10.0.0.0');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('allows the broadcast address of a /24 CIDR range', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['10.0.0.0/24']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('10.0.0.255');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('blocks an IP one step outside a /24 CIDR range', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['10.0.0.0/24']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('10.0.1.1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
  });

  it('allows an IP within a wide /8 CIDR range', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['10.0.0.0/8']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('10.255.255.1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('blocks an IP outside a /8 CIDR range', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['10.0.0.0/8']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('11.0.0.1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
  });

  it('allows an IP matching a /16 CIDR range', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['172.16.0.0/16']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('172.16.42.10');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('a /32 CIDR entry only allows the exact host IP', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['192.168.5.10/32']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('192.168.5.10');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('a /32 CIDR entry blocks an adjacent IP', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['192.168.5.10/32']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('192.168.5.11');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
  });

  it('allows any IPv4 address when 0.0.0.0/0 is in the whitelist', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['0.0.0.0/0']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('203.0.113.77');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('allows any IPv6 address when ::/0 is in the whitelist', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['::/0']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('2001:db8:85a3::1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('does not match IPv4 CIDR against an IPv6 address', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['192.168.0.0/16']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('2001:db8::1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
  });
});

// ── Wildcard bypass ───────────────────────────────────────────────────────────

describe('ipWhitelistMiddleware — wildcard bypass', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockRequest = { path: '/admin', method: 'GET', headers: {} };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
    jest.clearAllMocks();
  });

  it('allows all IPv4 traffic when 0.0.0.0/0 is the only whitelist entry', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['0.0.0.0/0']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('8.8.8.8');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('allows all IPv6 traffic when ::/0 is the only whitelist entry', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['::/0']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('::1');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('literal "*" in whitelist is treated as invalid and does not bypass protection', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['*']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('192.168.1.50');

    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
  });

  it('allows all traffic when both IPv4 and IPv6 wildcard ranges are present', () => {
    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['0.0.0.0/0', '::/0']);

    (requestIp.getClientIp as jest.Mock).mockReturnValue('1.2.3.4');
    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();

    (requestIp.getClientIp as jest.Mock).mockReturnValue('::1');
    ipWhitelistMiddleware(mockRequest as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalledTimes(1);
  });
});

// ── X-Forwarded-For handling ──────────────────────────────────────────────────

describe('ipWhitelistMiddleware — X-Forwarded-For handling', () => {
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;

  beforeEach(() => {
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
    jest.clearAllMocks();
  });

  it('allows access when X-Forwarded-For IP is whitelisted', () => {
    const xffIp = '10.0.0.42';
    const req: Partial<Request> = {
      path: '/admin',
      method: 'GET',
      headers: { 'x-forwarded-for': xffIp },
    };

    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['10.0.0.0/24']);
    (requestIp.getClientIp as jest.Mock).mockImplementation((r: any) => {
      const xff = r.headers?.['x-forwarded-for'] as string | undefined;
      return xff ? xff.split(',')[0].trim() : null;
    });

    ipWhitelistMiddleware(req as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('blocks access when X-Forwarded-For IP is not whitelisted', () => {
    const req: Partial<Request> = {
      path: '/admin',
      method: 'GET',
      headers: { 'x-forwarded-for': '203.0.113.5' },
    };

    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['10.0.0.0/8']);
    (requestIp.getClientIp as jest.Mock).mockImplementation((r: any) => {
      const xff = r.headers?.['x-forwarded-for'] as string | undefined;
      return xff ? xff.split(',')[0].trim() : null;
    });

    ipWhitelistMiddleware(req as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
  });

  it('uses the first IP from a multi-hop X-Forwarded-For header', () => {
    const req: Partial<Request> = {
      path: '/admin',
      method: 'GET',
      headers: { 'x-forwarded-for': '192.168.1.10, 10.0.0.1, 172.16.0.5' },
    };

    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['192.168.1.0/24']);
    (requestIp.getClientIp as jest.Mock).mockImplementation((r: any) => {
      const xff = r.headers?.['x-forwarded-for'] as string | undefined;
      return xff ? xff.split(',')[0].trim() : null;
    });

    ipWhitelistMiddleware(req as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });

  it('blocks when only a later hop in X-Forwarded-For matches the whitelist', () => {
    const req: Partial<Request> = {
      path: '/admin',
      method: 'GET',
      headers: { 'x-forwarded-for': '5.5.5.5, 192.168.1.10' },
    };

    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['192.168.1.0/24']);
    (requestIp.getClientIp as jest.Mock).mockImplementation((r: any) => {
      const xff = r.headers?.['x-forwarded-for'] as string | undefined;
      return xff ? xff.split(',')[0].trim() : null;
    });

    ipWhitelistMiddleware(req as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
  });

  it('falls back to direct connection IP when X-Forwarded-For is absent', () => {
    const req: Partial<Request> = {
      path: '/admin',
      method: 'GET',
      headers: {},
    };

    (runtime.getAdminIpWhitelist as jest.Mock).mockReturnValue(['127.0.0.1']);
    (requestIp.getClientIp as jest.Mock).mockReturnValue('127.0.0.1');

    ipWhitelistMiddleware(req as Request, mockResponse as Response, nextFunction);
    expect(nextFunction).toHaveBeenCalled();
  });
});
