// export const rgbToHex = (rgb: string): string => {
//     const [r, g, b] = rgb.split(",").map((num) => parseInt(num.trim(), 10));
//     return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
//   };
export const rgbToHex = (rgb) => {
    const result = rgb
        .match(/\d+/g)
        ?.map((x) => parseInt(x).toString(16).padStart(2, "0"))
        .join("");
    return result ? `#${result}` : "#000000";
};
