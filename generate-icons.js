const sharp = require('sharp');

const sizes = [16, 48, 128];

async function createIcon(size) {
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#00A1E0;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#008BBD;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="url(#grad)"/>
      <g transform="translate(${size * 0.15}, ${size * 0.15})">
        <rect x="${size * 0.05}" y="${size * 0.02}" width="${size * 0.6}" height="${size * 0.06}" rx="${size * 0.03}" fill="white" opacity="0.9"/>
        <rect x="${size * 0.05}" y="${size * 0.18}" width="${size * 0.5}" height="${size * 0.04}" rx="${size * 0.02}" fill="white" opacity="0.6"/>
        <rect x="${size * 0.05}" y="${size * 0.28}" width="${size * 0.7}" height="${size * 0.04}" rx="${size * 0.02}" fill="white" opacity="0.6"/>
        <rect x="${size * 0.05}" y="${size * 0.38}" width="${size * 0.4}" height="${size * 0.04}" rx="${size * 0.02}" fill="white" opacity="0.6"/>
        <rect x="${size * 0.05}" y="${size * 0.5}" width="${size * 0.65}" height="${size * 0.08}" rx="${size * 0.04}" fill="white" opacity="0.9"/>
        <circle cx="${size * 0.55}" cy="${size * 0.54}" r="${size * 0.05}" fill="#2E844A"/>
        <path d="M ${size * 0.5} ${size * 0.54} L ${size * 0.53} ${size * 0.57} L ${size * 0.59} ${size * 0.58}" 
              stroke="white" stroke-width="${size * 0.015}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </g>
    </svg>
  `;

  return sharp(Buffer.from(svg))
    .png()
    .toBuffer();
}

async function main() {
  try {
    for (const size of sizes) {
      const buffer = await createIcon(size);
      const filename = `icons/icon${size}.png`;
      require('fs').writeFileSync(filename, buffer);
      console.log(`Created ${filename}`);
    }
    console.log('All icons generated successfully!');
  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

main();
