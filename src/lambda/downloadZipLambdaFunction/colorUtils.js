export const rgbToHex = (rgb) => {
    // Ensure commas exist between values
    let parts = rgb.includes(",")
        ? rgb.split(",")
        : rgb.match(/.{1,3}/g); // fallback: split every 3 digits
    if (!parts)
        return "#000000";
    const hex = parts
        .map((x) => Number(x).toString(16).padStart(2, "0"))
        .join("");
    return `#${hex}`;
};
