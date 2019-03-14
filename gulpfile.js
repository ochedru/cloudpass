const fs = require("fs");
const path = require('path');
const gulp = require('gulp');
const deb = require('gulp-deb');
const rename = require("gulp-rename");
const merge = require('merge-stream');
//can't pipe with supertest (c.f. https://github.com/visionmedia/supertest/issues/49), use superagent directly
const request = require('superagent');
const Docker = require('dockerode-promise');
const tar = require('tar-fs');
const thenify = require('thenify');
const pkg = require('./package.json');

const debFileName = pkg.name + '_' + pkg.version + '_all.deb';

gulp.task('deb', function () {

    return merge(
        gulp.src(
            [
                '.',
                'src/**',
                'swagger/**',
                'migrations/**',
                'package.json'
            ],
            {base: process.cwd()}
        )
            .pipe(rename(function (path) {
                path.dirname = '/usr/share/cloudpass/' + path.dirname;
            })),
        gulp.src(['deb/data/**']),
        gulp.src(['.', 'default.yaml'], {cwd: 'config', base: 'config'}).pipe(rename({dirname: "/etc/cloudpass"}))
    )
        .pipe(deb(debFileName, {
            name: pkg.name,
            version: pkg.version,
            maintainer: {
                name: pkg.author.name,
                email: pkg.author.email
            },
            architecture: 'all',
            depends: [
                'nodejs(' + pkg.engines.node + ')',
                'postgresql',
                'openssl'
            ],
            section: 'misc',
            priority: 'extra',
            homepage: pkg.homepage,
            short_description: pkg.description,
            long_description: pkg.description,
            scripts: {
                preinst: fs.readFileSync("deb/control/preinst", "utf8"),
                postinst: fs.readFileSync("deb/control/postinst", "utf8"),
                prerm: fs.readFileSync("deb/control/prerm", "utf8"),
                postrm: fs.readFileSync("deb/control/postrm", "utf8")
            }
        }))
        .pipe(gulp.dest('build/'));
});

gulp.task('deploy-deb', gulp.series('deb', function () {
    const stream = fs.createReadStream('build/' + debFileName);
    stream.pipe(
        request.put('https://api.bintray.com/content/dhatim/deb/pool/main/c/cloudpass/' + debFileName)
            .auth(process.env.BINTRAY_NAME, process.env.BINTRAY_KEY)
            .set("Content-Type", "application/octet-stream")
            .set('X-Bintray-Package', 'cloudpass')
            .set('X-Bintray-Version', pkg.version)
            .set('X-Bintray-Publish', 1)
            .set('X-Bintray-Override', 1)
            .set('X-Bintray-Debian-Distribution', 'stable')
            .set('X-Bintray-Debian-Component', 'main')
            .set('X-Bintray-Debian-Architecture', 'all')
    );
    return stream;
}));


gulp.task('build-docker-image', function () {
    const docker = new Docker();

    const tarStream = tar.pack('.', {
        ignore: function (name) {
            return path.basename(name) === 'node_modules'; // don't upload modules
        }
    });

    return docker.buildImage(tarStream, {t: 'dhatim/cloudpass:' + pkg.version})
        .then(function (stream) {
            return thenify(docker.$subject.modem.followProgress)(stream);
        });

});