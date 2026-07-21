// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeExampleBrowser } from "@/components/home-example-browser";
import { homeExampleSeedCategories } from "@/lib/home-example-seeds";

describe("HomeExampleBrowser", () => {
  afterEach(() => {
    cleanup();
  });

  it("点击设计分类后展开设计示例", async () => {
    render(
      <HomeExampleBrowser
        categories={homeExampleSeedCategories}
        onExampleSelect={vi.fn()}
      />,
    );

    expect(
      screen.queryByText("设计包豪斯风格海报"),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "设计" }));

    expect(
      await screen.findByText("设计包豪斯风格海报"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("构思精美室内空间"),
    ).toBeInTheDocument();
  });

  it("auto-selects the first example when a category chip is clicked", async () => {
    const onExampleSelect = vi.fn();

    render(
      <HomeExampleBrowser
        categories={homeExampleSeedCategories}
        onExampleSelect={onExampleSelect}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "设计" }));

    expect(onExampleSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        categoryKey: "design",
        categoryLabel: "设计",
        title: "设计包豪斯风格海报",
        prompt:
          "Make a poster for a music festival in the Bauhaus style. Use a limited color palette of pink, red, and cream. Abstract geometric shapes representing sound waves. Minimalist vertical text.",
        previewImages: expect.arrayContaining([expect.stringMatching(/^\/images\/showcase\/showcase-\d+\.jpg$/)]),
      }),
    );
  });

  it("calls onExampleSelect with the picked example payload", async () => {
    const onExampleSelect = vi.fn();

    render(
      <HomeExampleBrowser
        categories={homeExampleSeedCategories}
        onExampleSelect={onExampleSelect}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "设计" }));
    await userEvent.click(
      await screen.findByRole("button", {
        name: "设计一套餐具陶瓷",
      }),
    );

    expect(onExampleSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categoryKey: "design",
        categoryLabel: "设计",
        title: "设计一套餐具陶瓷",
        prompt:
          "Generate a set of 5 images, each a ceramic tableware piece: 1 small bowl, 1 large bowl, 1 small plate, 1 large plate, 1 mug. They belong to the same set, harmoniously blends Scandinavian minimalism and Japanese wabi-sabi aesthetics - soft neutral tones, organic textures, imperfect hand-thrown forms, subtle glaze variations, natural lighting. Each piece is photographed against a seamless white background; even studio production photography lighting.",
        previewImages: expect.arrayContaining([expect.stringMatching(/^\/images\/showcase\/showcase-\d+\.jpg$/)]),
        inputMentions: [],
      }),
    );
  });
});
