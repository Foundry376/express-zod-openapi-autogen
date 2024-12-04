import { expect, spy, use } from "chai";
import chaiSpies from "chai-spies";
import { Router } from "express";
import type { PathItemObject } from "openapi3-ts/oas30";
import * as schemas from "../mocks/schemas";
import { buildOpenAPIDocument } from "./openAPI";
import { openAPIRoute } from "./openAPIRoute";

use(chaiSpies);

describe("buildOpenAPIDocument", () => {
  const openApiVersion = "3.0.0";
  afterEach(() => {
    spy.restore();
  });

  it("should generate an OpenAPI document with the provided config", () => {
    const config = { info: { title: "Test API", version: "1.0.0" } };
    const routers: Router[] = [];
    const schemaPaths: string[] = [];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors, openApiVersion });

    expect(document.openapi).to.equal(openApiVersion);
    expect(document.info.title).to.equal("Test API");
    expect(document.info.version).to.equal("1.0.0");
  });

  it("should work with additional OpenAPI versions", () => {
    const config = { info: { title: "Test API", version: "1.0.0" } };
    const routers: Router[] = [];
    const schemaPaths: string[] = [];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };
    const version = "3.1.0";

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors, openApiVersion: version });

    expect(document.openapi).to.equal(version);
    expect(document.info.title).to.equal("Test API");
    expect(document.info.version).to.equal("1.0.0");
  });

  it("should include security schemes if provided", () => {
    const config = { info: { title: "Test API", version: "1.0.0" } };
    const routers: Router[] = [];
    const schemaPaths: string[] = [];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };
    const securitySchemes = { bearerAuth: { type: "http" as const, scheme: "bearer" } };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors, securitySchemes, openApiVersion });

    expect(document.components!.securitySchemes).to.have.property("bearerAuth");
    expect(document.components!.securitySchemes!.bearerAuth).to.deep.equal({ type: "http", scheme: "bearer" });
  });

  it("should include zod schemas as schemas if provided", () => {
    const config = { info: { title: "Test API", version: "1.0.0" } };
    const routers: Router[] = [];
    const schemaPaths: string[] = ["../mocks/schemas"];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors, openApiVersion });

    expect(document.components!.schemas).to.have.property("BodySchema");
    expect(document.components!.schemas!.BodySchema).to.deep.equal({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      title: "User",
      description: "Required user information",
    });
    expect(document.components!.schemas!.QuerySchema).to.deep.equal({
      type: "object",
      properties: { name: { type: "string" }, age: { type: "number" } },
      required: ["name"],
      title: "User details",
      description: "Optional user information",
    });
  });

  it("should register routes from routers", () => {
    const config = { info: { title: "Test API", version: "1.0.0" } };
    const router = Router();
    router.get(
      "/test",
      openAPIRoute(
        {
          tag: "Test",
          summary: "Test route",
          query: schemas.QuerySchema,
          response: schemas.ResponseSchema,
        },
        (req, res) => res.json({ success: true }),
      ),
    );
    const routers: Router[] = [router];
    const schemaPaths: string[] = ["../mocks/schemas"];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors, openApiVersion });

    expect(document.paths).to.have.property("/test");
    expect(document.paths!["/test"]).to.have.property("get");
  });

  it("should include error responses if defined", () => {
    const config = { info: { title: "Test API", version: "1.0.0" } };
    const routers: Router[] = [];
    const schemaPaths: string[] = [];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors, openApiVersion });

    expect(document.paths).to.be.an("object");
    for (const path in document.paths) {
      for (const key in document.paths[path]) {
        const method = key as keyof PathItemObject;
        const { responses } = document.paths[path][method];
        expect(responses).to.have.property("401");
        expect(responses).to.have.property("403");
      }
    }
  });

  it("should warn about optional path parameters", () => {
    const config = { info: { title: "Test API", version: "1.0.0" } };
    const router = Router();
    router.get(
      "/test/:optional",
      openAPIRoute(
        {
          tag: "Test",
          summary: "Test route",
          // query schema has optional params
          params: schemas.QuerySchema,
          response: schemas.ResponseSchema,
        },
        (req, res) => res.json({ success: true }),
      ),
    );
    const routers: Router[] = [router];
    const schemaPaths: string[] = [];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const consoleSpy = spy.on(console, "warn");

    buildOpenAPIDocument({ config, routers, schemaPaths, errors, openApiVersion });
    expect(consoleSpy).to.have.been.called();
  });

  it("should create schema references for route responses when named", () => {
    const config = { info: { title: "Test API", version: "1.0.0" } };
    const router = Router();
    router.get(
      "/test",
      openAPIRoute(
        {
          tag: "Test",
          summary: "Test route",
          query: schemas.QuerySchema,
          response: schemas.ResponseSchema,
        },
        (req, res) => res.json({ success: true }),
      ),
    );
    const routers: Router[] = [router];
    const schemaPaths: string[] = ["../mocks/schemas"];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors, openApiVersion });
    const method = document.paths!["/test"].get;
    const responseSchema = method!.responses!["200"].content["application/json"].schema;

    expect(responseSchema.$ref.includes("ResponseSchema")).to.be.true;
  });

  it("should properly describe routes with request body", () => {
    const config = { info: { title: "Test API", version: "1.0.0" } };
    const router = Router();
    router.get(
      "/test",
      openAPIRoute(
        {
          tag: "Test",
          summary: "Test route",
          body: schemas.BodySchema,
          response: schemas.ResponseSchema,
        },
        (req, res) => res.json({ success: true }),
      ),
    );
    const routers: Router[] = [router];
    const schemaPaths: string[] = ["../mocks/schemas"];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors, openApiVersion });
    const method = document.paths!["/test"].get;
    // @ts-ignore
    const requestBodySchema = method!.requestBody?.content["application/json"].schema;

    expect(requestBodySchema.$ref.includes("BodySchema")).to.be.true;
  });
});
