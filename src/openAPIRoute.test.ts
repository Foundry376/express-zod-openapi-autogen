import { expect, spy, use } from "chai";
import spies from "chai-spies";
import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { BodySchema, ParamsSchema, QuerySchema, ResponseSchema } from "../mocks/schemas";
import { openAPIRoute } from "./openAPIRoute";

use(spies);

describe("openAPIRoute", () => {
  afterEach(() => {
    spy.restore();
  });

  const mockRequest = (body: any, query: any, params: any) =>
    ({
      body,
      query,
      params,
    } as unknown as Request);

  interface MockResponse extends Response {
    body?: any;
  }

  const mockResponse = () => {
    const res = {
      statusCode: 200,
    } as MockResponse;
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      return res;
    };
    return res;
  };

  const mockNext = () => {
    const next: NextFunction = (err?: any) => err;
    return next;
  };

  const schema = {
    tag: "Test",
    summary: "Test route",
    body: BodySchema,
    query: QuerySchema,
    params: ParamsSchema,
    response: ResponseSchema,
  };

  it("should validate request and call middleware", async () => {
    const handler = openAPIRoute(
      { ...schema, response: z.object({ success: z.literal("I am the middleware success") }) },
      (_req, res) => {
        res.json({ success: "I am the middleware success" });
      },
    );

    const req = mockRequest({ name: "John" }, { age: 30 }, { id: "123" });
    const res = mockResponse();
    const next = mockNext();

    handler(req, res, next);

    expect(res.statusCode).to.equal(200);
    expect(res.body).to.deep.equal({ success: "I am the middleware success" });
  });

  it("should return 400 if body validation fails", async () => {
    const handler = openAPIRoute(schema, (_req, res) => {
      res.json({ success: true });
    });

    const req = mockRequest({ name: 123 }, { age: 30 }, { id: "123" });
    const res = mockResponse();
    const next = mockNext();

    handler(req, res, next);

    expect(res.statusCode).to.equal(400);
    expect(res.body).to.have.property("error");
    expect(res.body.error).to.equal("name: Expected string, received number");
  });

  it("should return 400 if query validation fails", async () => {
    const handler = openAPIRoute(schema, (_req, res) => {
      res.json({ success: true });
    });

    const req = mockRequest({ name: "John" }, { age: "thirty" }, { id: "123" });
    const res = mockResponse();
    const next = mockNext();

    handler(req, res, next);

    expect(res.statusCode).to.equal(400);
    expect(res.body).to.have.property("error");
    expect(res.body.error).to.equal("age: Expected number, received string");
  });

  it("should return 400 if params validation fails", async () => {
    const handler = openAPIRoute(schema, (_req, res) => {
      res.json({ success: true });
    });

    const req = mockRequest({ name: "John" }, { age: 30 }, { id: 123 });
    const res = mockResponse();
    const next = mockNext();

    handler(req, res, next);

    expect(res.statusCode).to.equal(400);
    expect(res.body).to.have.property("error");
    expect(res.body.error).to.equal("id: Expected string, received number");
  });

  it("should validate response and log warning if it doesn't match schema", () => {
    const handler = openAPIRoute(schema, (req, res) => {
      // @ts-ignore
      res.json({ success: "true" });
    });

    const req = mockRequest({ name: "John" }, { age: 30 }, { id: "123" });
    const res = mockResponse();
    const next = mockNext();

    const consoleWarnStub = spy.on(console, "warn");

    handler(req, res, next);

    expect(consoleWarnStub).to.have.been.called();
  });
});
