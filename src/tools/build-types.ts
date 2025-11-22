import pkg from "../../package.json" with { type: "json" };

/** An entry in the file `assets/require.json` */
export type RequireObj = RequireObjPkg | RequireObjUrl;
type RequireObjUrl = {
  url: string;
};
export type RequireObjPkg = {
  pkgName: keyof (typeof pkg)["dependencies"] | keyof (typeof pkg)["devDependencies"];
  baseUrl?: string;
  path?: string;
};
