
export const rgbToHex = (rgb: string): string => {
    const result = rgb
      .match(/\d+/g)
      ?.map((x) => parseInt(x).toString(16).padStart(2, "0"))
      .join("");
    return result ? `#${result}` : "#000000";
  };
  