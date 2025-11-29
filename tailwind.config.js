/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./app/**/*.{js,jsx,ts,tsx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}"
    ],
    presets: [require("nativewind/preset")], // Add this line
    theme: {
        extend: {
            colors: {
                primary: '#ececec',
                secondary: {
                    100: '#3893fa',
                    200: '#366ab8',
                },
                light: '#ffffff',
                dark: {
                    100: '#221F3D',
                    200: '#0F0D23',
                },
                accent: '#2196F3',
                background: '#f1eee7',
            },
            spacing: {
                10: "2.5rem",
                15: "3.75rem",
                20: "5rem",
                25: "6.25rem",
                30: "7.5rem",
            },
        },
    },
    plugins: [],
};
