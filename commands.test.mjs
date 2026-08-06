import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { handleEdit } from "./commands.js";

const ownerId = process.env.BEAG_USER_ID || "795521432783552552";

test("handleEdit writes owner edits to a relative file inside the repo", async () => {
  const relativePath = "__test_cajh_edit__.txt";
  const fullPath = path.join(process.cwd(), relativePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

  let replyText = null;
  const message = {
    author: { id: ownerId },
    reply: async (text) => { replyText = text; return Promise.resolve(); }
  };

  await handleEdit(message, `${relativePath}\nhello world`);

  assert.ok(fs.existsSync(fullPath), "expected the edited file to exist");
  assert.equal(fs.readFileSync(fullPath, "utf8"), "hello world");
  assert.match(replyText, /✅ Saved \*\*/);

  fs.unlinkSync(fullPath);
});

test("handleEdit rejects non-owner edits", async () => {
  let replyText = null;
  const message = {
    author: { id: "123456789012345678" },
    reply: async (text) => { replyText = text; return Promise.resolve(); }
  };

  await handleEdit(message, "foo.txt\ncontent");
  assert.equal(replyText, "🚫 This command is restricted to cajh's owner.");
});
