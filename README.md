# Equipment Checkout V2
###### By: Asher Virgona
#### this is not so much of an improvement to the original but just a different way of doing it. This version can be completely offline and local. It uses Sqlite3 as a database instead of google sheets, however for ease of use it also writes all Database changes to an excel file on the server. Other than that its pretty much the same.
## Dependencies:
- Node.js
- HTML
- CSS
- JS

## Setting up
#### To setup the equipment check software simply ensure that node.js is installed on the computer, Please make sure you are connected to Global Connect Canada East to make sure the npm packages install correctly. Go to the project folder in a terminal and run `npm install`, this will install all dependencies (better-sqlite3, express, cors, uuid, and fs). After all dependencies are installed correclt in the same terminal simply run `node index.js`.

## Backend
#### The Backend code can be found at `./index.js`. is uses express and sqlite3 and is well commented. 
### End Point Flow
#### `syncExcel()`
##### - Removes all content from the excel sheets, and rewrites them from `./checkouts.db`. Uses helper function `syncSheet()` and `syncExcelWithRetry()` to retry the excel sync ever 2 seconds 5 times. This is because if someone has the excel file open it is impossible to write to it from a program. luckily even if all 5 fail the way the sync is programmed even if it gets synced the next week it will be perfecly up to date with the DB because it rewrites the sheets.
#### `/checkout/:user/:asset/:location`
##### - this adds a item to the `daily` table in `checkouts.db`. With the variables `user` -> `name`, `asset` -> `asset`, `location` -> `location`.
#### `/checkin/:id`
##### - this moves the item from the  `daily` table to the `master_log` table in `checkouts.db`. `:id` is unknown to the user and is generated on item checkout. This just serves as an absolute identifier for the item.
#### `/checkedout`
##### - returns all items in the `daily` table in `checkouts.db`.
#### `/master_log`
##### - returns all items in the `master_log` table in `checkouts.db`.
#### `/export/save`
##### - manually triggers the excel sync to server.
#### `/`
##### - returns if the api is running or not.

## Utilities
#### There are a few utility scripts like `clearDb.js` and `createTicket.ps1`.
#### `clearDb.js`
##### - This utility script can be found in `./`. its a VERY DANGEROUS SCRIPT. it clears the BOTH DAILY AND MASTER_LOG sheets and should only be used with extreme caution. 
#### `createTicket.ps1`
##### - This utility script can be found in the server at `\\jus00adc\library\scrips\equipment_checkout_v2\` it takes the json at `\\jus00adc\library\scrips\equipment_checkout_v2\ticketList.json` which automatically gets all the ticket info trom all returned items. running create tickets will ask you if you want to overwrite the current `tickets.txt` file which is the result of the program. Please make sure that the tickets in `tickets.txt` have already been filed. It will then ask for the RSO's name which will then ouput the ticket info in the exact same format as Hans script. It then clears the `ticketList.json`.

## Frontend
### Built with vanilla HTML, CSS, and JS.
#### Im not going to talk about the HTML or CSS in this Readme. this is easily mantainable and learnable fast. I will talk about each pages functions though.  
### Frontend JS
#### `fetchAssets()`
##### - Simplt fetches all items from the `daily` table in `checkouts.db`.
#### `filterAssets()`
##### - Filters the fetched items based on th value of the search bar.
#### `renderAssets()`
##### - takes the Assets from `filterAssets()` and makes `asset-card`s for each item to render them to the page
#### `handleCheckout()`
##### - gets values from the checkout form and sends it to the `/checkout` endpoint on node api
#### `handleReturn()`
##### - gets id from the rendered `asset-card` and sends it to the `/checkin` endpoint on node api.
#### `showToast()`
##### - sends a toast in the bottom right of the page to tell the user if the item was checked out properly or if there is an error
#### `formatDate()`
##### - formats date to make it human readable from ISO
#### `escHTML()`
##### - helper fcuntion to make writing chars easier.
#### the Frontend initiates by fetching the assets
### Page Functions
#### `index.html`
##### - the default page that allows users to checkout items, and search for already checkedout items (to checkin).
#### `admin.html`
##### - this page allows the IT Department to see all checkedout items, when they were checked out as well as the `master_log`. Also Search both DB tables. PLEASE NOTE THE ADMIN PAGE IS NOT PROTECTED IN ANY WAY, IN FACT THERE IS A LINK TO THE ADMIN PAGE IN THE TOP RIGHT OF THE INDEX PAGE. that being said theres nothing actually administrative that the admin page can do.
