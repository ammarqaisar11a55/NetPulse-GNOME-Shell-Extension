#!/usr/bin/env python3
"""Gives popup card screenshots transparent rounded corners.

Usage: tools/round-corners.py <radius> <image>...
"""
import sys

from PIL import Image, ImageDraw

radius = int(sys.argv[1])
for path in sys.argv[2:]:
    image = Image.open(path).convert('RGBA')
    mask = Image.new('L', image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, image.width - 1, image.height - 1), radius, fill=255)
    image.putalpha(mask)
    image.save(path)
