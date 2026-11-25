import path from "node:path"
import type { Element, Root as HtmlRoot } from "hast"
import type { Root as MarkdownRoot } from "mdast"
import { visit } from "unist-util-visit"
import sharp from "sharp"
import { write } from "./quartz/plugins/emitters/helpers"
import { loadQuartzConfig, loadQuartzLayout } from "./quartz/plugins/loader/config-loader"
import type {
  QuartzEmitterPluginInstance,
  QuartzTransformerPluginInstance,
} from "./quartz/plugins/types"
import { type FullSlug, QUARTZ, joinSegments, slugifyFilePath } from "./quartz/util/path"

const marker = "quartz-illustration-adaptation:"
const daySuffix = /[(（](\s*)д(\s*)[)）](\s*\.png)$/iu
const themeSuffix = /[(（]\s*([дн])\s*[)）]\s*(?=\.png$)/iu

function nameKey(name: string) {
  return name.normalize("NFC").toLowerCase().replace(themeSuffix, "($1)")
}

const markAdaptedIllustrations: QuartzTransformerPluginInstance = {
  name: "MarkAdaptedIllustrations",
  markdownPlugins: () => [
    () => (tree: MarkdownRoot) => {
      visit(tree, (node) => {
        if (String(node.type) !== "wikilink") return
        const wikilink = node as unknown as {
          embedded?: boolean
          heading?: string
          path?: string
          alias?: string
        }
        if (!wikilink.embedded || wikilink.heading?.toLowerCase() !== "adaptation") return
        if (!wikilink.path || !daySuffix.test(wikilink.path)) return

        const alias = wikilink.alias?.trim()
        const dimensionsOnly = alias && /^\d+(?:x\d+)?$/.test(alias)
        wikilink.alias =
          marker + (dimensionsOnly ? wikilink.path + "|" + alias : alias || wikilink.path)
      })
    },
  ],
}

const adaptIllustrations: QuartzTransformerPluginInstance = {
  name: "AdaptIllustrations",
  htmlPlugins(ctx) {
    const pngFiles = ctx.allFiles.filter((file) => /\.png$/i.test(file))
    const sourceBySlug = new Map(pngFiles.map((file) => [slugifyFilePath(file), file]))
    const nightByName = new Map<string, typeof pngFiles>()
    for (const file of pngFiles) {
      const name = path.posix.basename(file)
      if (name.match(themeSuffix)?.[1].toLowerCase() !== "н") continue
      const key = nameKey(name)
      const matches = nightByName.get(key) ?? []
      matches.push(file)
      nightByName.set(key, matches)
    }

    return [
      () => (tree: HtmlRoot, file) => {
        const slug = file.data.slug
        if (!slug) return
        visit(tree, "element", (node, index, parent) => {
          const { alt, src } = node.properties
          if (node.tagName !== "img" || typeof alt !== "string" || !alt.startsWith(marker)) return
          node.properties.alt = alt.slice(marker.length)
          if (typeof src !== "string" || index === undefined || !parent) return

          const imagePath = decodeURI(path.posix.join(path.posix.dirname(slug), src))
          const day = sourceBySlug.get(imagePath as ReturnType<typeof slugifyFilePath>)
          if (!day || !daySuffix.test(day)) return

          const expected = day.replace(daySuffix, "($1н$2)$3")
          const matches = nightByName.get(nameKey(path.posix.basename(expected))) ?? []
          const nearby = matches.filter(
            (candidate) => path.posix.dirname(candidate) === path.posix.dirname(day),
          )
          const night =
            nearby.find((candidate) => candidate === expected) ??
            (nearby.length === 1 ? nearby[0] : undefined) ??
            (nearby.length === 0 && matches.length === 1 ? matches[0] : undefined)
          if (!night) return

          const source: Element = {
            type: "element",
            tagName: "source",
            properties: {
              dataAdaptedIllustration: true,
              media: "not all",
              srcSet: "/" + encodeURI(slugifyFilePath(night)),
            },
            children: [],
          }
          parent.children[index] = {
            type: "element",
            tagName: "picture",
            properties: {},
            children: [source, node],
          }
        })
      },
    ]
  },
  externalResources: () => ({
    js: [
      {
        loadTime: "afterDOMReady",
        contentType: "inline",
        spaPreserve: true,
        script: `(() => {
          function updateIllustrations() {
            const dark = document.documentElement.getAttribute("saved-theme") === "dark";
            for (const source of document.querySelectorAll("source[data-adapted-illustration]")) {
              source.media = dark ? "all" : "not all";
            }
          }
          updateIllustrations();
          document.addEventListener("nav", updateIllustrations);
          document.addEventListener("themechange", updateIllustrations);
        })();`,
      },
    ],
  }),
}

const config = await loadQuartzConfig()
config.plugins.transformers.unshift(markAdaptedIllustrations)
config.plugins.transformers.push(adaptIllustrations)

const safariFavicon: QuartzEmitterPluginInstance = {
  name: "Favicon",
  async emit(ctx) {
    const size = 48
    const path = joinSegments(QUARTZ, "static/icon.png")
    const png = await sharp(path).resize(size, size).ensureAlpha().png().toBuffer()

    // ICO directory with one 32-bit image stored as a PNG.
    const header = Buffer.alloc(22)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(1, 4)
    header[6] = size
    header[7] = size
    header.writeUInt16LE(1, 10)
    header.writeUInt16LE(32, 12)
    header.writeUInt32LE(png.length, 14)
    header.writeUInt32LE(header.length, 18)

    const favicon = await write({
      ctx,
      slug: "favicon" as FullSlug,
      ext: ".ico",
      content: Buffer.concat([header, png]),
    })
    return [favicon]
  },
}

config.plugins.emitters = config.plugins.emitters.map((emitter) =>
  emitter.name === safariFavicon.name ? safariFavicon : emitter,
)
export default config
export const layout = await loadQuartzLayout()
