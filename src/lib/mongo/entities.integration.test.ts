/**
 * WorkOS org → entity lookup against a REAL MongoDB.
 *
 * `ensureEntityForWorkosOrg` finds an entity under the standard `workosOrgId`
 * or the legacy `workosOrganizationId` with an `$or` filter, and inserts new
 * entities with `workosOrgId`. Whether an upsert with an `$or` filter reuses
 * the legacy document instead of inserting a duplicate — and seeds nothing
 * from the filter on insert — is server behaviour a stub cannot prove, so it
 * runs against mongodb-memory-server (nyuchi/data-infra#179).
 */

import { beforeEach, describe, expect, it } from "vitest";

import { entitiesCollection } from "./databases";
import { ensureEntityForWorkosOrg, entityWorkosOrgId } from "./entities";
import { newId, stampNew } from "./ids";
import type { EntityDoc } from "./types";

/** A minimal, validator-complete organization entity, plus overrides. */
function entityFixture(overrides: Partial<EntityDoc>): EntityDoc {
  return {
    ...stampNew(),
    _id: newId(),
    entityType: "organization",
    ecosystemRole: "external",
    schemaOrgType: "Organization",
    slug: "fixture",
    name: "Fixture",
    isActive: true,
    isPrivateByDefault: false,
    ...overrides,
  } as EntityDoc;
}

beforeEach(async () => {
  await (await entitiesCollection()).deleteMany({});
});

describe("ensureEntityForWorkosOrg", () => {
  it("inserts a new entity under the standard workosOrgId only", async () => {
    const created = await ensureEntityForWorkosOrg({
      workosOrganizationId: "org_new",
      organizationName: "New Collective",
    });

    const raw = await (
      await entitiesCollection()
    ).findOne({ _id: created._id });
    expect(raw).not.toBeNull();
    expect(raw!.workosOrgId).toBe("org_new");
    expect(raw).not.toHaveProperty("workosOrganizationId");
    expect(raw!.name).toBe("New Collective");
    expect(raw!.createdAt).toBeInstanceOf(Date);
  });

  it("reuses an entity that already has the standard workosOrgId", async () => {
    const col = await entitiesCollection();
    const existing = entityFixture({ workosOrgId: "org_std", name: "Std" });
    await col.insertOne(existing);

    const found = await ensureEntityForWorkosOrg({
      workosOrganizationId: "org_std",
      organizationName: "Ignored",
    });

    expect(found._id).toBe(existing._id);
    expect(await col.countDocuments({})).toBe(1);
    // An existing entity is never overwritten.
    expect(found.name).toBe("Std");
  });

  it("finds an entity written under the legacy workosOrganizationId, without a duplicate or a rewrite", async () => {
    const col = await entitiesCollection();
    const legacy = entityFixture({
      workosOrganizationId: "org_legacy",
      name: "Legacy",
    });
    await col.insertOne(legacy);

    const found = await ensureEntityForWorkosOrg({
      workosOrganizationId: "org_legacy",
      organizationName: "Ignored",
    });

    expect(found._id).toBe(legacy._id);
    expect(await col.countDocuments({})).toBe(1);

    const raw = await col.findOne({ _id: legacy._id });
    expect(raw!.name).toBe("Legacy");
    // The legacy document is left exactly as it was: copying the field is the
    // data-infra script's job, not a side effect of a read.
    expect(raw).not.toHaveProperty("workosOrgId");
    expect(raw!.workosOrganizationId).toBe("org_legacy");
    // …and reads see its org id under either name.
    expect(entityWorkosOrgId(raw!)).toBe("org_legacy");
  });

  it("converges on one entity when replayed", async () => {
    const a = await ensureEntityForWorkosOrg({
      workosOrganizationId: "org_replay",
    });
    const b = await ensureEntityForWorkosOrg({
      workosOrganizationId: "org_replay",
    });

    expect(b._id).toBe(a._id);
    expect(
      await (
        await entitiesCollection()
      ).countDocuments({
        workosOrgId: "org_replay",
      }),
    ).toBe(1);
  });

  it("does not match a different organization under either field name", async () => {
    const col = await entitiesCollection();
    await col.insertMany([
      entityFixture({ workosOrgId: "org_a" }),
      entityFixture({ workosOrganizationId: "org_b" }),
    ]);

    const created = await ensureEntityForWorkosOrg({
      workosOrganizationId: "org_c",
    });

    expect(await col.countDocuments({})).toBe(3);
    expect(created.workosOrgId).toBe("org_c");
  });
});
