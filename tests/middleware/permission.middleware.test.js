const permit = require('../../src/middleware/permission.middleware');

function mockReqRes(apiKey) {
  return {
    req: { apiKey },
    res: {},
    next: jest.fn()
  };
}

describe('permission.middleware', () => {
  test('allows through when apiKey is null (auth disabled)', () => {
    const { req, res, next } = mockReqRes(null);
    permit('migrate:product')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('allows admin wildcard', () => {
    const { req, res, next } = mockReqRes({ permissions: ['*'] });
    permit('migrate:product')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('allows matching permission', () => {
    const { req, res, next } = mockReqRes({ permissions: ['migrate:product'] });
    permit('migrate:product')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('rejects missing permission', () => {
    const { req, res, next } = mockReqRes({ permissions: ['health:read'] });
    permit('migrate:product')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AuthorizationError'
    }));
  });
});

describe('permission.middleware — product:delete', () => {
  test('product:delete permission grants access to DELETE endpoint', () => {
    const { req, res, next } = mockReqRes({ permissions: ['product:delete'] });
    permit('product:delete')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('product:write does NOT grant delete access', () => {
    const { req, res, next } = mockReqRes({ permissions: ['product:write'] });
    permit('product:delete')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AuthorizationError'
    }));
  });

  test('wildcard * grants delete access', () => {
    const { req, res, next } = mockReqRes({ permissions: ['*'] });
    permit('product:delete')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });
});
