import { describe, expect, test } from "vitest";
import { Category, Connection, Group, TunnelConfig } from "../types";
import {
  groupsInCategory,
  sortCategories,
  sortConnections,
  sortGroups,
  sortTunnels,
  ungroupedConnections,
  uncategorizedGroups,
} from "./ordering";

const conn = (label: string, groupId?: string): Connection => ({
  id: `c-${label}`,
  label,
  host: "h",
  port: 22,
  username: "u",
  connectionType: "ssh",
  authType: "password",
  tags: [],
  createdAt: 0,
  groupId,
});

const group = (name: string, categoryId?: string): Group => ({
  id: `g-${name}`,
  name,
  categoryId,
});

const category = (name: string): Category => ({ id: `cat-${name}`, name });

const names = <T extends { name: string }>(xs: T[]) => xs.map((x) => x.name);
const labels = (xs: Connection[]) => xs.map((c) => c.label);

describe("sortGroups", () => {
  test("orders groups alphabetically regardless of creation order", () => {
    const groups = [group("Floor Switches T1"), group("Floor Switches T8"), group("Core Switches")];

    expect(names(sortGroups(groups))).toEqual([
      "Core Switches",
      "Floor Switches T1",
      "Floor Switches T8",
    ]);
  });

  test("orders embedded numbers naturally, not lexically", () => {
    const groups = [group("Floor Switches T10"), group("Floor Switches T2")];

    expect(names(sortGroups(groups))).toEqual(["Floor Switches T2", "Floor Switches T10"]);
  });

  test("ignores case differences when ordering", () => {
    const groups = [group("Floor Switches T6"), group("Floor Switches t5")];

    expect(names(sortGroups(groups))).toEqual(["Floor Switches t5", "Floor Switches T6"]);
  });

  test("does not mutate the array it is given", () => {
    const groups = [group("Zulu"), group("Alpha")];

    sortGroups(groups);

    expect(names(groups)).toEqual(["Zulu", "Alpha"]);
  });
});

describe("sortConnections", () => {
  test("orders connections by label", () => {
    const conns = [conn("swc306"), conn("BigBrother"), conn("appsvr2")];

    expect(labels(sortConnections(conns))).toEqual(["appsvr2", "BigBrother", "swc306"]);
  });

  test("produces the same order no matter what order it receives", () => {
    const punctuated = ["SP-Utilities", "sp_util", "SPUtilities", "SP Utilities"];
    const fromCreationOrder = labels(sortConnections(punctuated.map((l) => conn(l))));
    const fromReverseOrder = labels(sortConnections([...punctuated].reverse().map((l) => conn(l))));

    expect(fromReverseOrder).toEqual(fromCreationOrder);
  });
});

describe("sortCategories", () => {
  test("orders categories alphabetically", () => {
    const cats = [category("Switches"), category("Desktop VMs"), category("HMIs")];

    expect(names(sortCategories(cats))).toEqual(["Desktop VMs", "HMIs", "Switches"]);
  });
});

describe("groupsInCategory", () => {
  test("returns only that category's groups, sorted", () => {
    const switches = category("Switches");
    const groups = [
      group("Floor Switches T2", switches.id),
      group("Linux Servers", "cat-other"),
      group("Core Switches", switches.id),
    ];

    expect(names(groupsInCategory(groups, switches.id))).toEqual([
      "Core Switches",
      "Floor Switches T2",
    ]);
  });
});

describe("uncategorizedGroups", () => {
  test("returns groups that belong to no category, sorted", () => {
    const cats = [category("Switches")];
    const groups = [group("Zulu"), group("Alpha"), group("Floor Switches T1", "cat-Switches")];

    expect(names(uncategorizedGroups(groups, cats))).toEqual(["Alpha", "Zulu"]);
  });

  test("rescues a group whose category no longer exists", () => {
    const cats = [category("Switches")];
    const orphan = group("Imported Group", "cat-that-was-deleted");

    expect(names(uncategorizedGroups([orphan], cats))).toEqual(["Imported Group"]);
  });
});

describe("ungroupedConnections", () => {
  test("returns connections that belong to no group, sorted", () => {
    const groups = [group("Switches")];
    const conns = [conn("zebra"), conn("alpha"), conn("in-a-group", "g-Switches")];

    expect(labels(ungroupedConnections(conns, groups))).toEqual(["alpha", "zebra"]);
  });

  test("rescues a connection whose group no longer exists", () => {
    const orphan = conn("Imported Connection", "g-that-was-deleted");

    expect(labels(ungroupedConnections([orphan], []))).toEqual(["Imported Connection"]);
  });
});

describe("sortTunnels", () => {
  test("orders saved tunnels by name instead of when they were added", () => {
    const tunnel = (name: string): TunnelConfig => ({
      id: `t-${name}`,
      name,
      jumpHostId: "j",
      remoteHost: "h",
      remotePort: 443,
      localPort: 8443,
      createdAt: 0,
    });

    expect(sortTunnels([tunnel("zabbix"), tunnel("harbor")]).map((t) => t.name)).toEqual([
      "harbor",
      "zabbix",
    ]);
  });
});

describe("total ordering", () => {
  test("gives names that differ only by case an order of their own", () => {
    const forward = sortConnections([conn("VMWCashby"), conn("vmwcashby")]);
    const reversed = sortConnections([conn("vmwcashby"), conn("VMWCashby")]);

    expect(labels(reversed)).toEqual(labels(forward));
  });

  test("falls back to id so identical names never swap places", () => {
    const a: Group = { ...group("Core Switches"), id: "g-a" };
    const b: Group = { ...group("Core Switches"), id: "g-b" };

    expect(sortGroups([b, a]).map((g) => g.id)).toEqual(["g-a", "g-b"]);
  });
});
