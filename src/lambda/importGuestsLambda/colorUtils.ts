// export const rgbToHex = (rgb: string): string => {
//     const [r, g, b] = rgb.split(",").map((num) => parseInt(num.trim(), 10));
//     return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
//   };
  
// export const rgbToHex = (rgb: string): string => {
//     const result = rgb
//       .match(/\d+/g)
//       ?.map((x) => parseInt(x).toString(16).padStart(2, "0"))
//       .join("");
//     return result ? `#${result}` : "#000000";
//   };

  

export const rgbToHex = (rgb: string): string => {
  // Ensure commas exist between values
  let parts = rgb.includes(",")
    ? rgb.split(",")
    : rgb.match(/.{1,3}/g); // fallback: split every 3 digits

  if (!parts) return "#000000";

  const hex = parts
    .map((x) => Number(x).toString(16).padStart(2, "0"))
    .join("");

  return `#${hex}`;
};
