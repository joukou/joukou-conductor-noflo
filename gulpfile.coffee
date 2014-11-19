###*
@module joukou-conductor/gulpfile
@author Isaac Johnston <isaac.johnston@joukou.com>
@copyright 2014 Joukou Ltd. All rights reserved.
###

gulp        = require( 'gulp' )
plugins     = require( 'gulp-load-plugins' )( lazy: false )
lazypipe    = require( 'lazypipe' )
path        = require( 'path' )
del         = require( 'del' )

###*
Paths.
@namespace
###
paths =
  src:
    coffee: path.join( 'src', '**', '*.coffee' )
  dist:
    dir: 'dist'
    js: path.join( 'dist', '**', '*.js' )
    jsdocs: path.join( 'dist', 'docs', 'js' )
  test:
    coffee: path.join( 'test', '**', '*.coffee' )
    coverage: './coverage'

###*
Util functions.
@namespace
###
utils =
  isCI: ->
    process.env.CI is 'true'

###*
Lazypipes.
@namespace
###
lazypipes =
  mocha: lazypipe().pipe( plugins.mocha,
    ui: 'bdd'
    reporter: 'spec'
    compilers: 'coffee:coffee-script/register'
  )

###*
Task functions are defined independently of dependencies to enable re-use in
different lifecycles; e.g. single pass build vs watch based develop mode.
@namespace
###
tasks =
  sloc: ->
    gulp.src( paths.src.coffee )
      .pipe( plugins.sloc() )

  clean: ( done ) ->
    del( paths.dist.dir, done )

  coffeelint: ->
    gulp.src( paths.src.coffee )
      .pipe( plugins.coffeelint( optFile: 'coffeelint.json' ) )
      .pipe( plugins.coffeelint.reporter() )
      .pipe( plugins.coffeelint.reporter( 'fail' ) )

  coffee: ->
    gulp.src( paths.src.coffee )
      .pipe( plugins.sourcemaps.init() )
      .pipe( plugins.coffee( bare: true ).on( 'error', plugins.util.log ) )
      .pipe( plugins.sourcemaps.write( ) )
      .pipe( gulp.dest( paths.dist.dir ) )
      .on( 'error', plugins.util.log )

  test: ( done ) ->
    gulp.src( paths.dist.js )
    .pipe( plugins.istanbul() )
    .on( 'finish', ->
      gulp.src( [ paths.test.coffee ], read: false )
      .pipe( lazypipes.mocha( ) )
      .pipe( plugins.istanbul.writeReports( paths.test.coverage ) )
      .on( 'end', done )
    )
    return

  # coveralls: ->
  #   gulp.src( 'coverage/lcov.info' )
  #     .pipe( plugins.coveralls() )
  #     .on( 'end', ->
  #       process.exit(0)
  #     )

#
# General tasks.
#

gulp.task( 'sloc', tasks.sloc )
gulp.task( 'coffeelint', tasks.coffeelint )

#
# Build tasks.
#

gulp.task( 'clean:build', tasks.clean )
gulp.task( 'coffee:build', [ 'clean:build' ], tasks.coffee )
gulp.task( 'build', [ 'sloc', 'coffeelint', 'coffee:build' ] )

gulp.task( 'test:build', [ 'build' ], tasks.test )
gulp.task( 'test', [ 'test:build' ], ->
  # test is intended to be an interactively run build; i.e. not CI. Force a
  # clean exit due to issues with gulp-mocha not cleaning up gracefully.
  process.exit(0)
)

#
# Continuous-integration tasks.
#

gulp.task( 'ci', [ 'test:build' ] ) #, tasks.coveralls )

#
# Develop tasks.
#

gulp.task( 'coffee:develop', tasks.coffee )

gulp.task( 'test:develop', [ 'build' ], ->
  gulp.src( [ paths.dist.js, paths.test.coffee ], read: false )
    .pipe( plugins.watch( emit: 'all', ( files ) ->
      files
        .pipe( plugins.filter( path.join( '**', paths.test.coffee ) ) )
        .pipe( mocha() )
        .on( 'error', plugins.util.log )
    ) )
)

gulp.task( 'nodemon:develop', [ 'build' ], ->
  plugins.nodemon(
    script: 'dist/index.js'
    env:
      NODE_PORT: 2115
    ext: 'js'
    watch: [ 'dist', 'node_modules' ]
  )
  .on( 'restart', ->
    plugins.util.log( 'Server Restarted!' )
  )
)

gulp.task( 'develop', [ 'build', 'test:develop', 'nodemon:develop' ], ->
  gulp.watch( paths.src.coffee, [ 'sloc', 'coffeelint', 'coffee:develop' ] )
)