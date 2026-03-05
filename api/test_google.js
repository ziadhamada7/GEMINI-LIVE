import google from 'googlethis';

const query = process.argv[2] || 'ecommerce funnel diagram professional';

async function testGoogleSearch() {
    console.log(`Searching for: "${query}"...\n`);

    try {
        const cleanQuery = query.replace(/ educational diagram illustration/i, ' diagram').trim();

        const options = {
            page: 0,
            safe: false,
            additional_params: {
                hl: 'en',
                tbs: 'isz:l' // Filter: Large Images only (High Quality)
            }
        };

        const images = await google.image(cleanQuery, options);

        if (images && images.length > 0) {
            console.log(`✅ Found ${images.length} images! Here are the top 5 URLs:\n`);
            for (let i = 0; i < Math.min(5, images.length); i++) {
                const img = images[i];
                console.log(`${i + 1}. [${img.width}x${img.height}] ${img.url}`);
                console.log(`   Source: ${img.origin.title}\n`);
            }
        } else {
            console.log('❌ No images found for this query.');
        }
    } catch (err) {
        console.error(`❌ Error during search:`, err.message);
    }
}

testGoogleSearch();
