const path = require("path");
const webpack = require("webpack");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");  // Remplacer ExtractTextPlugin par MiniCssExtractPlugin

module.exports = env => {
    // Définir le mode (production ou développement)
    const mode = env && env.substring(0, 4) === "prod" ? "production" : "development";
    
    // Liste des plugins
    const plugins = [
        new MiniCssExtractPlugin({
            filename: path.relative(process.cwd(), path.join(__dirname, "dist", "css", "style.css")), // Définir où seront extraits les CSS
        })
    ];

    // Si c'est une version de production, on ajoute UglifyJsPlugin
    if (mode === "production") {
        plugins.push(
            new webpack.optimize.UglifyJsPlugin({
                compress: {
                    warnings: false
                },
                output: {
                    comments: false
                }
            })
        );
    }

    return {
        mode: mode, // Mode 'production' ou 'development'
        entry: {
            main: "./" + path.relative(process.cwd(), path.join(__dirname, "src", "Calendar", "Extension.tsx")),
            calendarServices: "./" + path.relative(process.cwd(), path.join(__dirname, "src", "Calendar", "CalendarServices.ts")),
            dialogs: "./" + path.relative(process.cwd(), path.join(__dirname, "src", "Calendar", "Dialogs.ts"))
        },
        output: {
            filename: path.relative(process.cwd(), path.join(__dirname, "dist", "js", "[name].js")),
            libraryTarget: "amd"
        },
        externals: [
            {
                react: true,
                "react-dom": true
            },
            /^TFS\//,
            /^VSS\//,
            /^Favorites\//
        ],
        resolve: {
            alias: { OfficeFabric: "../node_modules/office-ui-fabric-react/lib-amd" },
            extensions: [".ts", ".tsx", ".js"]
        },
        module: {
            rules: [
                { test: /\.tsx?$/, loader: "ts-loader" },
                {
                    test: /\.scss$/,
                    use: [
                        MiniCssExtractPlugin.loader,  // Utiliser MiniCssExtractPlugin.loader au lieu de "style-loader"
                        "css-loader",
                        "sass-loader",
                        "postcss-loader"
                    ]
                },
                {
                    test: /\.css$/,
                    use: [MiniCssExtractPlugin.loader, "css-loader"]  // Extraire les CSS séparément
                }
            ]
        },
        optimization: {
            splitChunks: {
                chunks: 'all',  // Diviser le code en morceaux
                maxSize: 244000, // Limiter la taille du bundle pour éviter les warnings
            },
        },
        plugins: plugins,  // Ajouter le plugin MiniCssExtractPlugin
        performance: {
            hints: false,  // Désactiver les avertissements de taille des fichiers
        },
        devtool: mode === 'production' ? false : 'inline-source-map', // Désactiver les source maps en production
    };
};
