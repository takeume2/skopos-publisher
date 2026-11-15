export type PageSize = "A4" | "A5" | "B5" | "Letter";
export type PageOrientation = "portrait" | "landscape";
export type DocumentTheme = "business" | "technical" | "minimal";
export type FontFamilyOption = "theme" | "sans" | "serif";
export type LogoPosition = "cover-only" | "header-only" | "cover-and-header";
export type TocDepth = 1 | 2 | 3;

export interface DocumentFrontmatter {
  title: string;
  subtitle: string;
  author: string;
  date: string;
  page_size: PageSize;
  orientation: PageOrientation;
  cover: boolean;
  back_cover: boolean;
  back_cover_text: string;
  toc: boolean;
  toc_depth: TocDepth;
  theme: DocumentTheme;
  primary_color: string;
  accent_color: string;
  font_family: FontFamilyOption;
  font_size: number;
  line_height: number;
  logo: string;
  logo_position: LogoPosition;
  header_left: string;
  header_right: string;
  footer_left: string;
  footer_right: string;
}

export const DEFAULT_FRONTMATTER: DocumentFrontmatter = {
  title: "文書タイトル",
  subtitle: "サブタイトル",
  author: "作成者・組織名",
  date: "2026-11-14",
  page_size: "A4",
  orientation: "portrait",
  cover: true,
  back_cover: true,
  back_cover_text: "発行元・連絡先・コピーライト情報",
  toc: true,
  toc_depth: 3,
  theme: "business",
  primary_color: "",
  accent_color: "",
  font_family: "theme",
  font_size: 10,
  line_height: 1.7,
  logo: "",
  logo_position: "cover-and-header",
  header_left: "{title}",
  header_right: "{date}",
  footer_left: "{author}",
  footer_right: "{page} / {pages}",
};

export interface TocEntry {
  id: string;
  level: 1 | 2 | 3;
  text: string;
}

export interface ParsedDocument {
  frontmatter: DocumentFrontmatter;
  body: string;
  rawYaml: string;
  hasFrontmatter: boolean;
}

export interface CompiledDocument {
  frontmatter: DocumentFrontmatter;
  html: string;
  tocEntries: TocEntry[];
}
