const axios = require("axios");
const cheerio = require("cheerio");
const https = require("https");
const _ = require("lodash");
const possibleSitemapRelativePaths = [
  "sitemap_index.xml",
  "sitemap.xml",
  "sitemap-index.xml",
  "sitemap/sitemap.xml",
  "sitemap/",
  "sitemapindex.xml",
  "sitemap/index.xml",
  "sitemap1.xml",
];

module.exports.extractUrlsFromDomain = async (domain) => {
  try {
    const results = { urls: {}, sitemapXMLHit: [], sitemapXMLMiss: [] };
    let content;
    try {
      content = await getWebpageContent(`https://www.${domain}/robots.txt`);
    } catch (e) {}
    const xmlUrlsFromSitemap = await tryGetSitemapUrlsFromRobotFile(content);
    const sitemapXMLUrls = !_.isEmpty(xmlUrlsFromSitemap)
      ? xmlUrlsFromSitemap
      : possibleSitemapRelativePaths.map((rp) => `https://www.${domain}/${rp}`);
    for (const s of sitemapXMLUrls) {
      let sitemapXMLUrl;
      let date;
      let metaLastModifiedSource;
      try {
        if (typeof s === "object") {
          sitemapXMLUrl = s.url;
          date = s.date ? s.date : new Date();
          metaLastModifiedSource = "parentXMLDate";
        } else {
          sitemapXMLUrl = s;
          date = new Date();
          metaLastModifiedSource = "scrapingDate";
        }
        content = await getWebpageContent(sitemapXMLUrl);
        const result = tryParsingSiteMapXML(
          content,
          date,
          metaLastModifiedSource
        );
        sitemapXMLUrls.push(...result.xmlUrls.map((x) => x.url));
        if (Object.keys(result.urls).length)
          results.sitemapXMLHit.push(sitemapXMLUrl);
        Object.assign(results.urls, result.urls);
      } catch (e) {
        results.sitemapXMLMiss.push(sitemapXMLUrl);
      }
    }

    return results;
  } catch (error) {
    throw new Error(`error at extractUrlsFromDomain. ${error}`);
  }
};

// takes sitemapXML content of one single page, and try to parse it.
const tryParsingSiteMapXML = (sitemapXML, date, metaLastModifiedSource) => {
  const results = { urls: {}, xmlUrls: [] };
  if (!_.isEmpty(sitemapXML)) {
    const cheerioInstance = cheerio.load(sitemapXML, { xmlMode: true });
    const lastModifiedDates = cheerioInstance("lastmod")
      .map((i, e) => cheerioInstance(e).text())
      .toArray();
    cheerioInstance("loc")
      .map((i, e) => cheerioInstance(e).text())
      .toArray()
      .forEach((u, i) => {
        try {
          if (u.endsWith(".xml")) {
            results.xmlUrls.push({
              url: u,
              date: new Date(lastModifiedDates[i]),
            });
          } else {
            results.urls[u] = {
              lastModified: new Date(lastModifiedDates[i] || date),
              metaLastModifiedSource,
            };
            results.urls[u].metaLastModifiedSource = lastModifiedDates[i]
              ? "dateAssociatedWithUrl"
              : metaLastModifiedSource;
          }
        } catch (e) {}
      });
  }

  return results;
};

// try to parse all possible lines, even if some are bad
// return only the good one an array
const tryGetSitemapUrlsFromRobotFile = (robotFileWebPageContent) => {
  if (_.isEmpty(robotFileWebPageContent)) return;
  const urls = [];
  robotFileWebPageContent.split("\n").forEach((l) => {
    try {
      const cleanLine = _.trim(l).toLowerCase();
      if (cleanLine.includes("sitemap") && cleanLine.endsWith(".xml")) {
        const cleanUrl = _.trim(
          cleanLine.split(" ")[1].replace(/\t/g, "").replace(/\r/g, "")
        );
        urls.push(cleanUrl);
      }
    } catch (e) {}
  });
  return urls;
};

const getWebpageContent = async (url, sizeLimitInBytes = 100000) => {
  try {
    let size = 0;
    const bufferArray = [];
    const response = await axios.get(url, {
      timeout: 5000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      responseType: "stream",
    });
    const stream = response.data;
    for await (const chunk of stream) {
      size += Buffer.byteLength(chunk);
      if (size > sizeLimitInBytes)
        throw new Error(
          `getWebpageContent File too large. ${(size, sizeLimitInBytes)}`
        );
      bufferArray.push(new Buffer.from(chunk));
    }
    return Buffer.concat(bufferArray).toString();
  } catch (e) {
    if (e.name === "getWebpageContent")
      throw new Error(`Failed at getWebpageContent: ${e}`);
  }
};
