#!/bin/bash

# Download 2K planet textures from Solar System Scope
# Textures are saved to public/assets/raw/ for verification

BASE_URL="https://www.solarsystemscope.com/textures/download"
OUTPUT_DIR="public/assets/raw"

mkdir -p "$OUTPUT_DIR"

echo "Downloading planet textures (2K resolution)..."
echo "================================================"

# Function to download a texture
download_texture() {
    local name=$1
    local filename=$2
    local url=$3

    echo "Downloading $name..."
    curl -L -o "$OUTPUT_DIR/$filename" "$url" 2>/dev/null

    if [ $? -eq 0 ] && [ -f "$OUTPUT_DIR/$filename" ]; then
        size=$(ls -lh "$OUTPUT_DIR/$filename" | awk '{print $5}')
        echo "  ✓ $name downloaded ($size)"
    else
        echo "  ✗ Failed to download $name"
    fi
}

# Try common URL patterns for Solar System Scope
# Pattern 1: Direct texture downloads (most likely)
download_texture "Mercury 2K" "mercury_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_mercury.jpg"
download_texture "Venus Surface 2K" "venus_surface_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_venus_surface.jpg"
download_texture "Venus Atmosphere 2K" "venus_atmosphere_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_venus_atmosphere.jpg"
download_texture "Earth Daymap 2K" "earth_daymap_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg"
download_texture "Earth Nightmap 2K" "earth_nightmap_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_earth_nightmap.jpg"
download_texture "Earth Clouds 2K" "earth_clouds_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_earth_clouds.jpg"
download_texture "Mars 2K" "mars_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_mars.jpg"
download_texture "Jupiter 2K" "jupiter_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_jupiter.jpg"
download_texture "Saturn 2K" "saturn_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_saturn.jpg"
download_texture "Saturn Ring 2K" "saturn_ring_2k.png" "https://www.solarsystemscope.com/textures/download/2k_saturn_ring_alpha.png"
download_texture "Uranus 2K" "uranus_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_uranus.jpg"
download_texture "Neptune 2K" "neptune_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_neptune.jpg"
download_texture "Moon 2K" "moon_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_moon.jpg"
download_texture "Sun 2K" "sun_2k.jpg" "https://www.solarsystemscope.com/textures/download/2k_sun.jpg"

echo ""
echo "================================================"
echo "Download complete! Check $OUTPUT_DIR/"
echo "Verify the textures, then move them to public/assets/planets/"
