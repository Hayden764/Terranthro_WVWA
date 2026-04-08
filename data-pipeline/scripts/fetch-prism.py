"""
PRISM Climate Data Fetcher for Terranthro

Downloads monthly PRISM climate data for wine regions.
Requires: requests, gdal, rasterio

Usage:
    python fetch_prism.py --year 2023 --variables tmin,tmax,ppt --regions napa,sonoma
"""

import os
import requests
import argparse
from datetime import datetime, timedelta
import zipfile
import tempfile

# PRISM data URLs
PRISM_BASE_URL = "https://prism.oregonstate.edu/recent/"
PRISM_VARIABLES = {
    'tmin': 'Minimum Temperature',
    'tmax': 'Maximum Temperature', 
    'ppt': 'Precipitation',
    'tdmean': 'Mean Temperature'
}

# Wine regions configuration
WINE_REGIONS = {
    'napa': {
        'name': 'Napa Valley',
        'bounds': (-122.6, 38.2, -122.0, 38.8)  # W, S, E, N
    },
    'sonoma': {
        'name': 'Sonoma County',
        'bounds': (-123.4, 38.1, -122.3, 38.9)
    },
    'willamette': {
        'name': 'Willamette Valley',
        'bounds': (-123.8, 44.3, -122.4, 45.6)
    },
    'columbia': {
        'name': 'Columbia Valley',
        'bounds': (-121.0, 45.5, -116.0, 47.5)
    }
}

def download_prism_file(variable, year, month, output_dir):
    """Download a single PRISM file."""
    
    # Format: PRISM_tmin_stable_4kmM3_202301_bil.zip
    date_str = f"{year}{month:02d}"
    filename = f"PRISM_{variable}_stable_4kmM3_{date_str}_bil.zip"
    url = f"{PRISM_BASE_URL}{filename}"
    
    output_path = os.path.join(output_dir, filename)
    
    print(f"Downloading {filename}...")
    
    try:
        response = requests.get(url, stream=True, timeout=60)
        response.raise_for_status()
        
        # Save zip file
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        # Extract zip file
        extract_dir = os.path.join(output_dir, f"{variable}_{date_str}")
        os.makedirs(extract_dir, exist_ok=True)
        
        with zipfile.ZipFile(output_path, 'r') as zip_ref:
            zip_ref.extractall(extract_dir)
        
        # Remove zip file to save space
        os.remove(output_path)
        
        print(f"✓ Downloaded and extracted {filename}")
        return extract_dir
        
    except Exception as e:
        print(f"✗ Failed to download {filename}: {e}")
        return None

def crop_to_region(input_path, output_path, region_bounds):
    """Crop raster to wine region bounds."""
    try:
        from osgeo import gdal
        
        # Open source dataset
        src_ds = gdal.Open(input_path)
        if not src_ds:
            raise Exception(f"Could not open {input_path}")
        
        # Crop to bounds (W, S, E, N)
        w, s, e, n = region_bounds
        
        # Use gdal.Translate to crop
        gdal.Translate(
            output_path,
            src_ds,
            projWin=[w, n, e, s],  # gdal wants [ulx, uly, lrx, lry]
            format='GTiff',
            creationOptions=['COMPRESS=DEFLATE', 'TILED=YES']
        )
        
        src_ds = None  # Close dataset
        return True
        
    except ImportError:
        print("GDAL not available. Install with: pip install gdal")
        return False
    except Exception as e:
        print(f"Error cropping {input_path}: {e}")
        return False

def main():
    parser = argparse.ArgumentParser(description='Download PRISM climate data for wine regions')
    parser.add_argument('--year', type=int, default=datetime.now().year-1, 
                       help='Year to download (default: last year)')
    parser.add_argument('--variables', default='tmin,tmax,ppt',
                       help='Comma-separated list of variables to download')
    parser.add_argument('--regions', default='napa,sonoma',
                       help='Comma-separated list of regions to process')
    parser.add_argument('--output-dir', default='./data/prism',
                       help='Output directory for downloaded data')
    parser.add_argument('--months', default='1-12',
                       help='Month range to download (e.g., 1-12 or 4,5,6)')
    
    args = parser.parse_args()
    
    # Parse variables and regions
    variables = [v.strip() for v in args.variables.split(',')]
    regions = [r.strip() for r in args.regions.split(',')]
    
    # Parse months
    if '-' in args.months:
        start, end = map(int, args.months.split('-'))
        months = list(range(start, end + 1))
    else:
        months = [int(m.strip()) for m in args.months.split(',')]
    
    # Create output directory
    os.makedirs(args.output_dir, exist_ok=True)
    
    print(f"📥 Downloading PRISM data for {args.year}")
    print(f"   Variables: {', '.join(variables)}")
    print(f"   Regions: {', '.join(regions)}")
    print(f"   Months: {', '.join(map(str, months))}")
    print(f"   Output: {args.output_dir}")
    print()
    
    total_files = len(variables) * len(months) * len(regions)
    completed = 0
    
    for variable in variables:
        if variable not in PRISM_VARIABLES:
            print(f"⚠️  Unknown variable: {variable}")
            continue
            
        var_dir = os.path.join(args.output_dir, variable)
        os.makedirs(var_dir, exist_ok=True)
        
        for month in months:
            # Download national data
            with tempfile.TemporaryDirectory() as temp_dir:
                extract_dir = download_prism_file(variable, args.year, month, temp_dir)
                
                if extract_dir:
                    # Find the .bil file
                    bil_file = None
                    for file in os.listdir(extract_dir):
                        if file.endswith('.bil'):
                            bil_file = os.path.join(extract_dir, file)
                            break
                    
                    if bil_file:
                        # Process each region
                        for region in regions:
                            if region not in WINE_REGIONS:
                                print(f"⚠️  Unknown region: {region}")
                                continue
                            
                            region_config = WINE_REGIONS[region]
                            output_filename = f"{variable}_{args.year}_{month:02d}_{region}.tif"
                            output_path = os.path.join(var_dir, output_filename)
                            
                            # Crop to region
                            success = crop_to_region(bil_file, output_path, region_config['bounds'])
                            if success:
                                print(f"✓ Created {output_filename}")
                            
                            completed += 1
                            print(f"   Progress: {completed}/{total_files}")
    
    print(f"\n🎉 Download complete! Files saved to {args.output_dir}")

if __name__ == "__main__":
    main()
