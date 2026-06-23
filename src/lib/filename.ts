/**
 * Filename helpers shared by the browser and the file viewer. The key rule
 * (issue: renaming must not let you change the format): renames edit the base
 * name only; the final extension is locked. `splitExt` is how we keep them apart.
 */

/**
 * Split a filename into its base and its final extension (extension INCLUDES
 * the leading dot, or is "" when there is none). Dotfiles (".env") and
 * extensionless names return an empty extension so the whole thing stays
 * editable.
 *
 *   "photo.png"   -> { base: "photo",   ext: ".png" }
 *   "a.tar.gz"    -> { base: "a.tar",   ext: ".gz"  }  // only the last ext locks
 *   "README"      -> { base: "README",  ext: ""     }
 *   ".env"        -> { base: ".env",    ext: ""     }
 */
export function splitExt(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}
