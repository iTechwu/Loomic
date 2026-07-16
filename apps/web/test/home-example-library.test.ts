import { describe, expect, it } from "vitest";

import { mapHomeExampleRows } from "@/lib/home-example-library";

type HomeExampleCategoryRow = { key: string; label: string; data_type: string; accent: string | null; sort_order: number; [key: string]: unknown };
type HomeExampleExampleRow = { category_key: string; title: string; prompt: string; image_urls: string[]; input_mentions: unknown; sort_order: number; [key: string]: unknown };

describe("mapHomeExampleRows", () => {
  it("groups and sorts categories and examples into the home browser shape", () => {
    const categories: HomeExampleCategoryRow[] = [
      {
        key: "video",
        label: "Video",
        data_type: "Video",
        accent: null,
        sort_order: 2,
        is_active: true,
        created_at: "2026-03-29T00:00:00.000Z",
        updated_at: "2026-03-29T00:00:00.000Z",
      },
      {
        key: "design",
        label: "Design",
        data_type: "Poster",
        accent: null,
        sort_order: 1,
        is_active: true,
        created_at: "2026-03-29T00:00:00.000Z",
        updated_at: "2026-03-29T00:00:00.000Z",
      },
    ];

    const examples: HomeExampleExampleRow[] = [
      {
        id: "example-b",
        category_key: "design",
        title: "Second",
        prompt: "Prompt B",
        image_urls: ["b-1", "b-2"],
        input_mentions: [{ type: "tool", name: "Nano Banana", imgSrc: "tool.svg" }],
        sort_order: 1,
        is_active: true,
        created_at: "2026-03-29T00:00:00.000Z",
        updated_at: "2026-03-29T00:00:00.000Z",
      },
      {
        id: "example-a",
        category_key: "design",
        title: "First",
        prompt: "Prompt A",
        image_urls: ["a-1", "a-2"],
        input_mentions: [{ type: "image", name: "Logo", imgSrc: "logo.png" }],
        sort_order: 0,
        is_active: true,
        created_at: "2026-03-29T00:00:00.000Z",
        updated_at: "2026-03-29T00:00:00.000Z",
      },
    ];

    expect(mapHomeExampleRows(categories, examples)).toEqual([
      {
        key: "design",
        label: "Design",
        dataType: "Poster",
        examples: [
          {
            title: "First",
            prompt: "Prompt A",
            previewImages: ["a-1", "a-2"],
            inputMentions: [{ type: "image", name: "Logo", imgSrc: "logo.png" }],
          },
          {
            title: "Second",
            prompt: "Prompt B",
            previewImages: ["b-1", "b-2"],
            inputMentions: [{ type: "tool", name: "Nano Banana", imgSrc: "tool.svg" }],
          },
        ],
      },
      {
        key: "video",
        label: "Video",
        dataType: "Video",
        examples: [],
      },
    ]);
  });
});
