# Licence notes

## NSE market data - proprietary, private use only

The NSE market statistics page carries this notice beneath its tables:

> All data and information provided by the NSE, except as otherwise indicated,
> is proprietary to the NSE. You may not copy ...

The clause continues beyond what has been read. Until the full text is read and
cleared, every NSE series is registered as `proprietary-private-use` and three
rules hold in code, not in good intentions:

1. **Held, not published.** `PriceStore.emit(..., private=False)` raises rather
   than writing an NSE series to any path that is not Brian's own device.
2. **Not redistributed.** No public bucket, no public repository, no third party.
3. **Fetched as a person would.** The collector uses the page's own
   "Download Daily Equity Price List" link, once a day, after the close, with
   `robots.txt` checked before every request.

This is a personal research cache of a page Brian may lawfully read. It is not a
data product, and nothing in this repository may turn it into one.

**Open question for Brian.** Read the full disclaimer on the page and decide
whether an automated daily download is within it. If it is not, the compliant
shape is the manual one already built: download the file yourself and drop it in.
That path needs no adapter and no permission.

## Everything else

CBK key rates, treasury bond auction results and World Bank indicators are
published by public institutions for public use. They are marked `unverified`
until a machine that can reach them confirms the terms, and they are the only
series a public emit will write.

## Removed

The Dow Jones Industrial Average and the Nasdaq Composite were registered and
then deleted on Brian's instruction. Index levels are licensed intellectual
property and no part of the mandatory output turned on them.
