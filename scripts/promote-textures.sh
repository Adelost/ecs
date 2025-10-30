#!/bin/bash

# Promote verified textures from raw/ to planets/
# Renames them to match the naming convention in solarSystem.ts

RAW_DIR="public/assets/raw"
PLANETS_DIR="public/assets/planets"

echo "Promoting textures to planets directory..."
echo "==========================================="

mkdir -p "$PLANETS_DIR"

# Function to promote a texture
promote() {
    local src=$1
    local dest=$2

    if [ -f "$RAW_DIR/$src" ]; then
        cp "$RAW_DIR/$src" "$PLANETS_DIR/$dest"
        echo "  ✓ $src → $dest"
    else
        echo "  ✗ $src not found"
    fi
}

# Promote planet textures
promote "mercury_2k.jpg" "mercury.png"
promote "venus_surface_2k.jpg" "venus.png"
promote "earth_daymap_2k.jpg" "earth.png"
promote "mars_2k.jpg" "mars.png"
promote "jupiter_2k.jpg" "jupiter.png"
promote "saturn_2k.jpg" "saturn.png"
promote "uranus_2k.jpg" "uranus.png"
promote "neptune_2k.jpg" "neptune.png"

# Optional: Moon and Sun
promote "moon_2k.jpg" "moon.png"
promote "sun_2k.jpg" "sun.png"

# Bonus textures (keep in raw for later use)
echo ""
echo "Additional textures available in raw/:"
echo "  - venus_atmosphere_2k.jpg"
echo "  - earth_nightmap_2k.jpg"
echo "  - earth_clouds_2k.jpg"
echo "  - saturn_ring_2k.png"

echo ""
echo "==========================================="
echo "Textures promoted to $PLANETS_DIR/"
echo "Your solar system now has high-quality textures!"
