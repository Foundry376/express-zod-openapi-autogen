import { expect, spy, use } from "chai";
import chaiSpies from "chai-spies";
import { Router } from "express";
import * as schemas from "../mocks/schemas";
import { buildOpenAPIDocument } from "./openAPI";
import { openAPIRoute } from "./openAPIRoute";

use(chaiSpies);

describe("buildOpenAPIDocument", () => {
  afterEach(() => {
    spy.restore();
  });

  it("should generate an OpenAPI document with the provided config", () => {
    const config = { openapi: "3.0.0", info: { title: "Test API", version: "1.0.0" } };
    const routers: Router[] = [];
    const schemaPaths: string[] = [];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors });

    expect(document.openapi).to.equal("3.0.0");
    expect(document.info.title).to.equal("Test API");
    expect(document.info.version).to.equal("1.0.0");
  });

  it("should include security schemes if provided", () => {
    const config = { openapi: "3.0.0", info: { title: "Test API", version: "1.0.0" } };
    const routers: Router[] = [];
    const schemaPaths: string[] = [];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };
    const securitySchemes = { bearerAuth: { type: "http" as const, scheme: "bearer" } };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors, securitySchemes });

    expect(document.components!.securitySchemes).to.have.property("bearerAuth");
    expect(document.components!.securitySchemes!.bearerAuth).to.deep.equal({ type: "http", scheme: "bearer" });
  });

  it("should include zod schemas as schemas if provided", () => {
    const config = { openapi: "3.0.0", info: { title: "Test API", version: "1.0.0" } };
    const routers: Router[] = [];
    const schemaPaths: string[] = ["../mocks/schemas"];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors });

    expect(document.components!.schemas).to.have.property("BodySchema");
    expect(document.components!.schemas!.BodySchema).to.deep.equal({
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    });
  });

  it("should register routes from routers", () => {
    const config = { openapi: "3.0.0", info: { title: "Test API", version: "1.0.0" } };
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
    const schemaPaths: string[] = [];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors });

    expect(document.paths).to.have.property("/test");
    expect(document.paths["/test"]).to.have.property("get");
  });

  it("should include error responses if defined", () => {
    const config = { openapi: "3.0.0", info: { title: "Test API", version: "1.0.0" } };
    const routers: Router[] = [];
    const schemaPaths: string[] = [];
    const errors = { 401: "Unauthorized", 403: "Forbidden" };

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors });

    expect(document.paths).to.be.an("object");
    for (const path in document.paths) {
      for (const method in document.paths[path]) {
        expect(document.paths[path][method].responses).to.have.property("401");
        expect(document.paths[path][method].responses).to.have.property("403");
      }
    }
  });

  it("should warn about optional path parameters", () => {
    const config = { openapi: "3.0.0", info: { title: "Test API", version: "1.0.0" } };
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

    buildOpenAPIDocument({ config, routers, schemaPaths, errors });
    expect(consoleSpy).to.have.been.called();
  });

  it("should create schema references for route responses when named", () => {
    const config = { openapi: "3.0.0", info: { title: "Test API", version: "1.0.0" } };
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

    const document = buildOpenAPIDocument({ config, routers, schemaPaths, errors });

    const responseSchema = document.paths["/test"].get.responses["200"].content["application/json"].schema;

    expect(responseSchema.allOf.some((a: any) => a.$ref.includes("ResponseSchema"))).to.be.true;
  });
});
