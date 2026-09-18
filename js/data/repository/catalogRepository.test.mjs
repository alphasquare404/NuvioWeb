import assert from "node:assert/strict";
import test from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { CatalogApi } = await import("../remote/api/catalogApi.js");
const { catalogRepository } = await import("./catalogRepository.js");

test("catalog keeps valid entries when the add-on returns malformed metadata", async () => {
  const originalGetCatalog = CatalogApi.getCatalog;
  const request = {
    addonBaseUrl: "https://addon.example",
    addonId: "test-addon",
    catalogId: "test-catalog",
    type: "series"
  };
  try {
    for (const [metas, expectedIds, hasMore] of [
      [
        [
          { id: "tt1", name: "First" },
          null,
          { id: "tt2" },
          { id: " ", name: "Missing ID" },
          { id: "tt3", name: "  Third  " }
        ],
        ["tt1", "tt3"],
        true
      ],
      [[null, {}, { id: "tt4", name: " " }], [], true],
      [{ unexpected: "object" }, [], false],
      [[], [], false]
    ]) {
      catalogRepository.catalogCache.clear();
      CatalogApi.getCatalog = async () => ({ metas });
      const result = await catalogRepository.getCatalog(request);
      assert.equal(result.status, "success");
      assert.deepEqual(
        result.data.items.map((item) => item.id),
        expectedIds
      );
      assert.equal(result.data.hasMore, hasMore);
      if (expectedIds.length) {
        assert.equal(result.data.items[1].name, "  Third  ");
        assert.equal(result.data.items[0].addonId, request.addonId);
      }
      assert.deepEqual(await catalogRepository.getCatalog(request), result);
    }
    catalogRepository.catalogCache.clear();
    CatalogApi.getCatalog = async () => ({ metas: [{ id: "tt1", name: "First" }] });
    assert.equal(
      (await catalogRepository.getCatalog({ ...request, supportsSkip: false })).data.hasMore,
      false
    );
  } finally {
    CatalogApi.getCatalog = originalGetCatalog;
    catalogRepository.catalogCache.clear();
  }
});
