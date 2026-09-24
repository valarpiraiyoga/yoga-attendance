// Run with `npm test` (Node's built-in test runner).
//
// The Students search box matches name, phone, or batch (name / code of a
// batch the student is actively enrolled in). `buildStudentSearchFilter` is
// the pure step that turns those matches into one `.or()` filter.

import test from "node:test";
import assert from "node:assert/strict";
import { buildStudentSearchFilter } from "./search.js";

test("without batch matches the filter is the original name-or-phone one", () => {
  assert.equal(buildStudentSearchFilter("kav"), "full_name.ilike.%kav%,phone.ilike.%kav%");
  assert.equal(buildStudentSearchFilter("kav", []), "full_name.ilike.%kav%,phone.ilike.%kav%");
});

test("students enrolled in a matching batch are added by id", () => {
  assert.equal(
    buildStudentSearchFilter("hyg", ["a1", "b2"]),
    "full_name.ilike.%hyg%,phone.ilike.%hyg%,id.in.(a1,b2)"
  );
});

test("an already-escaped term is used as given", () => {
  assert.equal(buildStudentSearchFilter("a\,b"), "full_name.ilike.%a\,b%,phone.ilike.%a\,b%");
});
