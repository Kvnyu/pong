import {fromEvent, interval} from "rxjs";
import {filter, map, merge, scan} from "rxjs/operators";

if (typeof window != 'undefined')
    window.onload = () => {
        pong();
    };

//Constants allow me to reference numbers that are reused a lot

const
    Constants = new class{
    readonly player1X = 535;
    readonly player1Y = 275;
    readonly player2X = 65;
    readonly player2Y = 275;
    readonly ballXY = 296;
    readonly paddleWidth = 10;
    readonly paddleHeight = 50;
    readonly ballHeight = 8;
    readonly canvasXY = 600;
    readonly gamePoints = 7;
    readonly botReactionX = 300;
    readonly ballAcceleration = 1.1;
    }


function pong() {

    // This game has many types which are used to encourage polymorphism.
    type Key = 'ArrowUp' | 'ArrowDown'
    type Event = 'keydown' | 'keyup'
    type ViewType = 'paddle' | 'ball'
    type Score = Readonly<{
        player1: number,
        player2: number
    }>
    //These types are read only so that they can only be interacted with in a functional programming way. The
    //component array is also declared readonly so that it is deeply immutable, in line with functional programming
    //principles
    type State = Readonly<{
        time: number,
        score: Score
        paddles: ReadonlyArray<Body>,
        ball: Body,
        gameOver: boolean
    }>
    type Body = Readonly<{
        id: string,
        viewType: ViewType,
        pos: Vec,
        vel: Vec,
        acc: number
    }>

    //Reusable functions are nice
    function createPaddle(id: string, viewType: ViewType, pos: Vec, vel: Vec, acc: number): Body {
        return {
            id: id,
            viewType: viewType,
            pos: pos,
            vel: vel,
            acc:acc
        }
    }

    function createBall(pos: Vec, vel: Vec, acc: number): Body {
        return {
            id: 'ball',
            viewType: "ball",
            pos: pos,
            vel: vel,
            acc: acc
        }

    }

    //These two classes create objects that are passed through the observable stream. Tick only carries the elapsed time
    //The reduceState uses these classes to identify what logic to perform, like using cases. This is better than using
    //Something like a string to identify the what logic to perform, as it can carry data, and you can pinpoint more easily
    //Which stream the element was created from
    class Tick {
        constructor(public readonly elapsed: number) {
        }
    }

    class Move {
        constructor(public readonly direction: number) {
        }
    }

    //These constant paddles, balls, score, and initial state are reused throughout the game's lifecycle. Eliminates
    //The need to repeat code
    const initialFriendlyPaddleBody = createPaddle('friendlypaddle', 'paddle', new Vec(Constants.player1X, Constants.player1Y), new Vec(0, 0),0),
        initialEnemyPaddleBody = createPaddle('enemypaddle', 'paddle', new Vec(Constants.player2X, Constants.player2Y), new Vec(0, 0),0),
        initialBallBody = createBall(new Vec(Constants.ballXY, Constants.ballXY), Vec.unitVecInDirection(90),Constants.ballAcceleration),
        initialScore: Score = {player1: 0, player2: 0},
        startPaddles = [...Array(2)]
            .map((_, i) => i == 0 ? initialFriendlyPaddleBody : initialEnemyPaddleBody),
        initialState: State = {
            time: 0,
            score: initialScore,
            paddles: startPaddles,
            ball: initialBallBody,
            gameOver: false
        };

    //This function is reduces the repetition of creating streams of events and filtering the input
    //It utilizes the types of events and keys defined before, encouraging polymorphism
    const keyObservable = <T>(e: Event, k: Key, result: () => T) =>
            fromEvent<KeyboardEvent>(document, e)
                .pipe(
                    filter(({code}) => code === k),
                    filter(({repeat}) => !repeat),
                    map(result)),

        //Theses streams utilise the move class defined before to pass information about the key press to the stream
        //to be utilised later
        goUp = keyObservable('keydown', 'ArrowUp', () => new Move(-2)),
        goDown = keyObservable('keydown', 'ArrowDown', () => new Move(2)),
        stopUp = keyObservable('keyup', 'ArrowUp', () => new Move(0)),
        stopDown = keyObservable('keyup', 'ArrowDown', () => new Move(0));


    const
        paddleOutOfYBounds = (o: Body) => o.viewType == "paddle" && (o.pos.y < 0 || o.pos.y > 550),
        //moveObj function takes advantage of polymorphism as mentioned in the report
        moveObj = (o: Body) => <Body>{
            ...o,
            pos: paddleOutOfYBounds({...o, pos: o.pos.add(o.vel)}) ? o.pos : o.pos.add(o.vel)
        },

        handleCollisions = (s: State) => {
            //Here we have many small pure functions that each have one purpose
            //This makes the logic of this section much easier to digest
            //The use of the constants means that if we decide to change the paddle/ball size we don't have to change
            //Every single occurence of whatever it is
            //These functions check for collisions on surfaces, and calculate resulting velocities
            const collidedWithPaddle = (ball: Body, paddle: Body) => Math.abs(ball.pos.x - paddle.pos.x) <= Constants.ballHeight
                && ball.pos.y + Constants.ballHeight >= paddle.pos.y
                && ball.pos.y <= paddle.pos.y + Constants.paddleHeight;

            const collidedWithWall = (a: Body) => a.pos.y <= Constants.ballHeight || a.pos.y + Constants.ballHeight >= Constants.canvasXY;
            const outOfXBounds = (a: Body) => (a.pos.x > Constants.canvasXY || a.pos.x < 0);
            const XBoundSide = (a: Body) => (a.pos.x > Constants.canvasXY) ? 1 : 2;//Checks whether it hit player 1 or 2's side
            const paddleCollisionNewVelocity = (a: Body, b: Body) => Vec.unitVecInDirection(-Math.sign(a.vel.x) * 90 * (1 - (2 / 95) * Math.abs(b.pos.y + (Constants.paddleHeight / 2 )- (a.pos.y + (Constants.ballHeight / 2))))).scale(a.vel.len());
            const wallNewVelocity = (a: Body) => new Vec(a.vel.x, -a.vel.y);

            /*
            These functions all take the same input, so they can all be called as newBall(s.ball). Originally this section
            had a lot of if else statements to handle all the different cases that could occur, like hitting the wall,
            hitting a paddle etc...

            By using reduce in finding newball, I am able to check if it has collided with a vertical/horizontal wall,
            or a paddle, and return the respective type of new ball, or return the initialBall if it isn't found.
            Since all of the createball functions have the same calling interface (polymorphism?) They can be called
            by newBall(s.ball) in the same way, meaning that I don't have to create different return statements for
            each case.

            Since these functions are general they also don't have to be changed if more balls are created etc
            These functions create balls for the different types of collisions

             */

            const collidedPaddleCreate = (a: Body) => createBall((new Vec(collidedPaddle[0].pos.x +
                Math.sign(paddleCollisionNewVelocity(a, collidedPaddle[0]).x) * 15, a.pos.y)), paddleCollisionNewVelocity(a, collidedPaddle[0]).scale(a.acc),Constants.ballAcceleration)
            const collidedWallCreate = (a: Body) => createBall(a.pos, wallNewVelocity(a).scale(a.acc),Constants.ballAcceleration)
            const initialBallBodyCreate = (a: Body) => initialBallBody
            const currentBallBodyCreate = (a: Body) => a

            const collidedPaddle: Array<Body> = s.paddles.filter((paddle) => collidedWithPaddle(s.ball, paddle));
            const newBallConditionals = [collidedPaddle.length == 1, collidedWithWall(s.ball), outOfXBounds(s.ball)]
            const newBalls: ReadonlyArray<(Body) => Body> = [collidedPaddleCreate, collidedWallCreate, initialBallBodyCreate
            ]

            const newBall = newBalls.reduce((acc, current, index) => newBallConditionals[index] ? current : acc, currentBallBodyCreate)
            const newScore = outOfXBounds(s.ball) ? XBoundSide(s.ball) == 1 ? {
                player1: s.score.player1 + 1,
                player2: s.score.player2
            } : {player1: s.score.player1, player2: s.score.player2 + 1} : s.score
            const newPaddles = outOfXBounds(s.ball) ? startPaddles : s.paddles
            console.log(s.ball.vel.len())
            return {
                ...s,
                paddles: newPaddles,
                ball: newBall(s.ball),
                score: newScore,
                gameOver: s.score.player1 >= Constants.gamePoints || s.score.player2 >= Constants.gamePoints
            }
        },
        /*
          Execute tick handles the internal logic, mainly physics stuff


        */
        executeTick = (s: State, elapsed: number) => {
            //These functions inform us of where the ball is in relation to the paddle
            const PaddleUpper = (paddle: Body, ball: Body) => (paddle.pos.y <= ball.pos.y && paddle.pos.y + Constants.paddleHeight / 2 >= ball.pos.y)
                ,
                outsideOfPaddleLower = (paddle: Body, ball: Body) => (paddle.pos.y + Constants.paddleHeight/2 >= ball.pos.y),
                leftSide = (ball:Body) => (ball.pos.x<Constants.botReactionX) //Change botReactionX to change the difficulty of the bot (how closely the bot follows the ball

            //This bit uses map to find the enemypaddle and update its velocity based on the position of the ball
            const paddles = s.paddles.map((paddle, i) => (paddle.id == "enemypaddle") ? {
                    ...paddle,
                    vel: new Vec(0, leftSide(s.ball)?(PaddleUpper(paddle, s.ball) || outsideOfPaddleLower(paddle, s.ball) ? -2 : 2):0)
                } : paddle
            )
            return handleCollisions({
                ...s,
                paddles: paddles
                    .map(moveObj),
                ball: moveObj(s.ball),
                time: elapsed
            })
        },


        reduceState = (s: State, e: Tick | Move) =>

            e instanceof Move ? {
                    ...s,
                    paddles: s.paddles.map((paddle, i) => (paddle.id == "friendlypaddle") ? {
                            ...paddle,
                            vel: new Vec(0, e.direction)
                        } : paddle
                    )
                }
                : executeTick(s, e.elapsed);

    const subscription = interval(1).pipe(
        map(elapsed => new Tick(elapsed)),
        merge(goUp, goDown, stopUp, stopDown),
        scan(reduceState, initialState)
    ).subscribe(updateView);

    function updateView(s: State): void {
        const friendlypaddle = document.getElementById("friendlypaddle");
        const enemypaddle = document.getElementById("enemypaddle");
        const ball = document.getElementById("ball");
        const player1score = document.getElementById('player1score');
        const player2score = document.getElementById('player2score');
        const blocker = document.getElementById('blocker');
        const winner = document.getElementById('winner');
        const gameOver = document.getElementById('gameOver');
        const playButtongroup = document.getElementById('playButtonGroup');
        const playButton = document.getElementById('playButton');
        const gameOverView: Array<HTMLElement> = [blocker, winner, gameOver, playButtongroup, playButton, playButtongroup]
        //Here I create the gameOverView array so that I can map over it and call a function on each element when it is
        //game over. This saves me from having to code many lines of setting the display to 'block' or 'none', and to
        //add another element to display or hide I can simply add another HTML element to this list.

        friendlypaddle.setAttribute('transform',
            `translate(${s.paddles[0].pos.x},${s.paddles[0].pos.y})`);
        enemypaddle.setAttribute('transform',
            `translate(${s.paddles[1].pos.x},${s.paddles[1].pos.y})`);

        ball.setAttribute('transform',
            `translate(${s.ball.pos.x},${s.ball.pos.y})`);

        player1score.textContent = 'Points:'.concat(s.score.player1.toString());
        player2score.textContent = 'Points:'.concat(s.score.player2.toString());


        if (s.gameOver) {
            winner.textContent = "Player ".concat((s.score.player1 > s.score.player2) ? '1' : '2', " wins");
            gameOverView.map((element) => element.style.display = "block")
            subscription.unsubscribe();
            const playAgain$ = fromEvent<MouseEvent>(playButton, 'mousedown')
            playAgain$.pipe(
                map(({clientX, clientY}) => {
                    return

                    }
                ),
            ).subscribe((_)=> {

                gameOverView.map((element) => element.style.display = "none");
                pong();
            })


        }

    }
}


class Vec {
    constructor(public readonly x: number = 0, public readonly y: number = 0) {
    }

    add = (b: Vec) => new Vec(this.x + b.x, this.y + b.y);
    sub = (b: Vec) => this.add(b.scale(-1));
    len = () => Math.sqrt(this.x * this.x + this.y * this.y);
    scale = (s: number) => new Vec(this.x * s, this.y * s);
    ortho = () => new Vec(this.y, -this.x);
    rotate = (deg: number) =>
        (rad => (
                (cos, sin, {x, y}) => new Vec(x * cos - y * sin, x * sin + y * cos)
            )(Math.cos(rad), Math.sin(rad), this)
        )(Math.PI * deg / 180);

    static unitVecInDirection = (deg: number) => new Vec(0, -1).rotate(deg);
    static Zero = new Vec();
}





  
  

