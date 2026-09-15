import { strict as assert } from "node:assert";
import { getCurrentSessionAccess } from "./discord-role-model.js";

const env = {
  DISCORD_ADMIN_ROLE_ID: "admin",
  DISCORD_MODERATOR_ROLE_ID: "moderator",
  DISCORD_ZONE_MANAGER_ROLE_ID: "zone-manager",
  DISCORD_TEMPLATE_MANAGER_ROLE_ID: "template-manager",
  DISCORD_ALLY_ROLE_ID: "ally",
  DISCORD_COMMUNARD_ROLE_ID: "communard"
};

assert.equal(getCurrentSessionAccess(["admin"], env, "1", "dev"), "admin");
assert.equal(getCurrentSessionAccess(["moderator"], env, "1", "dev"), "moderator");
assert.equal(getCurrentSessionAccess(["communard"], env, "1", "dev"), "member");
assert.equal(getCurrentSessionAccess([], env, "dev", "dev"), "zone_admin");

console.log("PASS: current privileged access policy");
