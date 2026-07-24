import { z } from "zod";

export const IMAGE_STYLE_SLUGS = [
  "pop-art",
  "minimal",
  "retro",
  "watercolor",
  "fantasy",
  "moody",
  "vibrant",
  "cinematic",
  "cyberpunk",
  "surreal",
  "art-deco",
  "grafiti",
] as const;

const imageStyleSlugEnum = z.enum(IMAGE_STYLE_SLUGS);

export const imageStyleSlugSchema = z.preprocess(
  (value) => (value === "Surreal" ? "surreal" : value),
  imageStyleSlugEnum,
);

export type ImageStyleSlug = z.infer<typeof imageStyleSlugSchema>;
