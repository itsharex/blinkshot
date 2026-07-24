import cinematicImage from "@/public/styles/cinematic.png";
import fantasyImage from "@/public/styles/fantasy.png";
import minimalImage from "@/public/styles/minimal.png";
import moodyImage from "@/public/styles/moody.png";
import popArtImage from "@/public/styles/pop-art.png";
import retroImage from "@/public/styles/retro.png";
import vibrantImage from "@/public/styles/vibrant.png";
import watercolorImage from "@/public/styles/watercolor.png";
import artDecoImage from "@/public/styles/art-deco.jpeg";
import cyberpunkImage from "@/public/styles/cyberpunk.jpeg";
import grafitiImage from "@/public/styles/grafiti.jpeg";
import surrealImage from "@/public/styles/surreal.jpeg";
import type { ImageStyleSlug } from "@/lib/image-style-slugs";
import type { StaticImageData } from "next/image";

export const IMAGE_STYLES = [
    {
        label: "Pop Art",
        value: "pop-art",
        image: popArtImage,
    },
    {
        label: "Minimal",
        value: "minimal",
        image: minimalImage,
    },
    {
        label: "Retro",
        value: "retro",
        image: retroImage,
    },
    {
        label: "Watercolor",
        value: "watercolor",
        image: watercolorImage,
    },
    {
        label: "Fantasy",
        value: "fantasy",
        image: fantasyImage,
    },
    {
        label: "Moody",
        value: "moody",
        image: moodyImage,
    },
    {
        label: "Vibrant",
        value: "vibrant",
        image: vibrantImage,
    },
    {
        label: "Cinematic",
        value: "cinematic",
        image: cinematicImage,
    },
    {
        label: "Cyberpunk",
        value: "cyberpunk",
        image: cyberpunkImage,
    },
    {
        label: "Surreal",
        value: "surreal",
        image: surrealImage,
    },
    {
        label: "Art Deco",
        value: "art-deco",
        image: artDecoImage,
    },
    {
        label: "Grafiti",
        value: "grafiti",
        image: grafitiImage,
    },
] satisfies Array<{
    label: string;
    value: ImageStyleSlug;
    image: StaticImageData;
}>;
