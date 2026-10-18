const express = require("express");

const app = express();

const port = process.env.PORT;

app.listen(port, () => {
    console.log(`CODEFAMT API is running at http://localhost:${port}`);
});
